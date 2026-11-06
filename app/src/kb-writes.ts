/**
 * Every write to the knowledge base, each with the commit that records it.
 *
 * `Content`, `labels.ts`, `gallery.ts` and `space-instructions.ts` change files
 * and hand back the paths they touched; recording those paths in git, and saying
 * in the commit subject what happened, is this module's job. The web server and
 * the MCP server both write through it, so the same write commits the same
 * paths under the same subject whichever of them made it. Only the `via` suffix
 * differs: it names who wrote (`web`, `mcp`, `chat`).
 *
 * A write that fails throws, and nothing was written. A write whose commit fails
 * has still landed on disk, so it resolves with `commitError` set instead: the
 * caller still has the mutation and can say what was saved.
 */

import type {
  ArchiveMutation,
  BatchMoveMutation,
  Content,
  CreatePageMutation,
  DeleteMutation,
  DeleteSpaceMutation,
  MoveMutation,
  RawPage,
  RenameSpaceMutation,
  ReorderMutation,
} from "./content.js";
import { deleteImage, saveImage, type ImageDeletion, type SavedImage } from "./gallery.js";
import type { Git } from "./git.js";
import {
  applyPageLabels,
  colorOf,
  createLabel,
  deleteLabel,
  loadLabelSet,
  updateLabel,
  type LabelMutation,
} from "./labels.js";
import { ensureSpaceInstructions, type EnsureInstructionsResult } from "./space-instructions.js";

export interface Written<M> {
  mutation: M;
  /** Short sha of the commit, or null when there was nothing to commit or no git. */
  commit: string | null;
  /** Set when the write landed on disk but committing it failed. */
  commitError?: string;
}

/** A page save from the editor: the new source and, optionally, a new last slug segment. */
export interface PageSave {
  page: RawPage;
  /** The slug change, when one was asked for and the slug really changed. */
  renamed: MoveMutation | null;
  /** Why the slug change asked for did not happen. The content is saved and committed regardless. */
  renameError?: string;
}

/** An upload to a space's gallery. Saving stops at the first image that fails. */
export interface ImageUpload {
  saved: SavedImage[];
  /** Why the image after the last saved one could not be saved. */
  saveError?: string;
}

export interface KbWritesDeps {
  content: Content;
  git: Pick<Git, "commitFiles" | "commitMovedPaths" | "kbRelPath" | "initSpaceRepo">;
  /** Who is writing, for the end of every commit subject: `web`, `mcp`, `chat`. */
  via: string;
}

export type KbWrites = ReturnType<typeof makeKbWrites>;

export function makeKbWrites({ content, git, via }: KbWritesDeps) {
  /**
   * Commit `fsPaths` with `subject`. `moved` stages deletions and additions
   * alike (`git add -A`), which a rename or a leaf promotion needs. No paths
   * means nothing changed, and nothing is committed.
   */
  async function record<M>(
    mutation: M,
    fsPaths: string[],
    subject: string,
    moved = false
  ): Promise<Written<M>> {
    if (fsPaths.length === 0) return { mutation, commit: null };
    const message = `${subject} via ${via}`;
    try {
      const commit = moved
        ? await git.commitMovedPaths(fsPaths, message)
        : await git.commitFiles(fsPaths, message);
      return { mutation, commit };
    } catch (err) {
      return { mutation, commit: null, commitError: errorMessage(err) };
    }
  }

  /** A section is named by its slug, a single page by its file. */
  function target(mutation: { isSection: boolean; slug: string; fsPath: string }): string {
    return mutation.isSection ? mutation.slug : git.kbRelPath(mutation.fsPath);
  }

  /** A new page or folder; a leaf parent promoted into a section moves, so it commits as a move. */
  function recordCreate(mutation: CreatePageMutation): Promise<Written<CreatePageMutation>> {
    const subject = `Create ${git.kbRelPath(mutation.fsPath)}`;
    return mutation.changedFsPaths
      ? record(mutation, mutation.changedFsPaths, subject, true)
      : record(mutation, [mutation.fsPath], subject);
  }

  function recordUpdate(page: RawPage): Promise<Written<RawPage>> {
    return record(page, [page.fsPath], `Update ${git.kbRelPath(page.fsPath)}`);
  }

  function moveSubject(move: MoveMutation): string {
    return `Move ${move.oldSlug} to ${move.newSlug}`;
  }

  function renameSubject(rename: MoveMutation): string {
    return `Rename ${rename.oldSlug} to ${rename.newSlug}`;
  }

  return {
    /** An untitled page, opened in the editor straight after. */
    async createDraft(parentSlug: string): Promise<Written<CreatePageMutation>> {
      return recordCreate(await content.createDraft(parentSlug));
    },

    async createPage(
      parentSlug: string,
      title: string,
      body: string,
      opts: { tags?: string[]; summary?: string } = {}
    ): Promise<Written<CreatePageMutation>> {
      return recordCreate(await content.createPage(parentSlug, title, body, opts));
    },

    async createFolder(parentSlug: string, title?: string): Promise<Written<CreatePageMutation>> {
      return recordCreate(await content.createFolder(parentSlug, title));
    },

    /** A space is its own git repo, so its repo is made before the scaffolding is committed into it. */
    async createSpace(title: string): Promise<Written<CreatePageMutation>> {
      const mutation = await content.createSpace(title);
      try {
        await git.initSpaceRepo(mutation.slug);
      } catch (err) {
        return { mutation, commit: null, commitError: errorMessage(err) };
      }
      return record(
        mutation,
        mutation.changedFsPaths ?? [mutation.fsPath],
        `Create ${git.kbRelPath(mutation.fsPath)}`
      );
    },

    /** Replace a page's whole source. Null when the page does not exist. */
    async updatePage(slug: string, raw: string): Promise<Written<RawPage> | null> {
      const page = await content.updateRaw(slug, raw);
      return page && recordUpdate(page);
    },

    /**
     * The editor's save: the new source, and a new last slug segment when one
     * is given. A slug change lands in the same commit as the edit, so the
     * diff of the renamed page still shows what was written. A slug change
     * that fails leaves the edit saved, and it is committed on its own.
     */
    async savePage(slug: string, raw: string, newLeaf?: string): Promise<Written<PageSave> | null> {
      const page = await content.updateRaw(slug, raw);
      if (!page) return null;

      let renamed: MoveMutation | null = null;
      if (newLeaf) {
        try {
          renamed = await content.renamePage(page.slug, newLeaf);
        } catch (err) {
          const { commit, commitError } = await recordUpdate(page);
          return { mutation: { page, renamed: null, renameError: errorMessage(err) }, commit, commitError };
        }
        if (renamed && renamed.newSlug === renamed.oldSlug) renamed = null;
      }

      if (renamed) return record({ page, renamed }, renamed.changedFsPaths, renameSubject(renamed), true);
      const { commit, commitError } = await recordUpdate(page);
      return { mutation: { page, renamed }, commit, commitError };
    },

    /**
     * Rewrite a page to add, edit or resolve inline notes. `action` opens the
     * commit subject and ends in the word the page's path follows: "Add note
     * to", "Resolve note on". Through `updateRaw`, so the write is held to the
     * same frontmatter and folder rules as any other edit.
     */
    async writeNotes(slug: string, raw: string, action: string): Promise<Written<RawPage> | null> {
      const page = await content.updateRaw(slug, raw);
      return page && record(page, [page.fsPath], `${action} ${git.kbRelPath(page.fsPath)}`);
    },

    /** Archive or restore a page, a section's whole subtree, or a space. Null when it does not exist. */
    async setArchived(slug: string, archived: boolean): Promise<Written<ArchiveMutation> | null> {
      const mutation = await content.updateArchive(slug, archived);
      if (!mutation) return null;
      return record(
        mutation,
        mutation.changedFsPaths,
        `${archived ? "Archive" : "Restore"} ${target(mutation)}`
      );
    },

    async deletePage(slug: string): Promise<Written<DeleteMutation> | null> {
      const mutation = await content.deletePage(slug);
      if (!mutation) return null;
      return record(mutation, mutation.deletedFsPaths, `Delete ${target(mutation)}`);
    },

    async movePage(sourceSlug: string, targetParentSlug: string | null): Promise<Written<MoveMutation> | null> {
      const mutation = await content.movePage(sourceSlug, targetParentSlug);
      if (!mutation) return null;
      return record(mutation, mutation.changedFsPaths, moveSubject(mutation), true);
    },

    /** Several pages dropped on one parent, in one commit. Pages that could not move are reported, not thrown. */
    async movePages(
      sourceSlugs: string[],
      targetParentSlug: string | null
    ): Promise<Written<BatchMoveMutation>> {
      const mutation = await content.movePages(sourceSlugs, targetParentSlug);
      const { moves } = mutation;
      if (moves.length === 0) return { mutation, commit: null };
      const parent = moves[0].newSlug.split("/").slice(0, -1).join("/") || "root";
      const subject = moves.length === 1 ? moveSubject(moves[0]) : `Move ${moves.length} pages to ${parent}`;
      return record(mutation, mutation.changedFsPaths, subject, true);
    },

    /**
     * Place pages at an exact spot in a group. One drop can both re-parent and
     * renumber, so the subject names whichever is the point: a plain
     * arrangement inside one group, or the move that carried the page there
     * (the renumbering rides along in the same commit).
     */
    async reorderPages(
      sourceSlugs: string[],
      parentSlug: string,
      beforeSlug: string
    ): Promise<Written<ReorderMutation>> {
      const mutation = await content.reorderPages(sourceSlugs, parentSlug, beforeSlug);
      const { moves } = mutation;
      if (mutation.orderedSlugs.length === 0) return { mutation, commit: null };
      const subject =
        moves.length === 0
          ? `Reorder pages in ${mutation.parentSlug}`
          : moves.length === 1
            ? moveSubject(moves[0])
            : `Move ${moves.length} pages to ${mutation.parentSlug}`;
      return record(mutation, mutation.changedFsPaths, subject, true);
    },

    /** Change a page's last slug segment. An unchanged slug commits nothing. Null when the page does not exist. */
    async renamePage(slug: string, newLeaf: string): Promise<Written<MoveMutation> | null> {
      const mutation = await content.renamePage(slug, newLeaf);
      if (!mutation) return null;
      if (mutation.newSlug === mutation.oldSlug) return { mutation, commit: null };
      return record(mutation, mutation.changedFsPaths, renameSubject(mutation), true);
    },

    /** Change a folder's display name; its slug stays. An unchanged name commits nothing. */
    async renameFolder(
      slug: string,
      name: string
    ): Promise<Written<{ slug: string; fsPath: string; changedFsPaths: string[] }> | null> {
      const mutation = await content.renameFolder(slug, name);
      if (!mutation) return null;
      return record(mutation, mutation.changedFsPaths, `Rename folder ${mutation.slug}`);
    },

    /** Change a space's display name; its key stays. An unchanged name commits nothing. */
    async renameSpace(key: string, title: string): Promise<Written<RenameSpaceMutation> | null> {
      const mutation = await content.renameSpace(key, title);
      if (!mutation) return null;
      return record(mutation, mutation.changedFsPaths, `Rename space ${mutation.key}`);
    },

    /** Delete a space outright. Its git repo goes with it, so there is nothing left to commit into. */
    deleteSpace(key: string): Promise<DeleteSpaceMutation | null> {
      return content.deleteSpace(key);
    },

    /** Make sure a space's instructions file exists; committed only when this call created it. */
    async ensureInstructions(spaceKey: string): Promise<Written<EnsureInstructionsResult>> {
      const mutation = await ensureSpaceInstructions(content, spaceKey);
      return record(mutation, mutation.changedFsPaths, `Create ${git.kbRelPath(mutation.fsPath)}`);
    },

    /** Set a page's labels, defining `create` in the space's palette first when given. Null when the page does not exist. */
    async labelPage(
      slug: string,
      names: readonly string[],
      create?: { name: string; color: string }
    ): Promise<Written<LabelMutation> | null> {
      const mutation = await applyPageLabels(content, slug, names, create);
      if (!mutation) return null;
      if (mutation.changedFsPaths.length === 0) return { mutation, commit: null };
      const fsPath = await content.resolve(slug);
      return record(mutation, mutation.changedFsPaths, `Label ${fsPath ? git.kbRelPath(fsPath) : slug}`);
    },

    async createLabel(spaceKey: string, name: string, color: string): Promise<Written<LabelMutation>> {
      const mutation = await createLabel(content, spaceKey, name, color);
      return record(mutation, mutation.changedFsPaths, `Create label ${subjectSafe(mutation.name)} in ${spaceKey}`);
    },

    /** Rename and/or recolour a label, across every page that carries it. */
    async updateLabel(
      spaceKey: string,
      name: string,
      change: { name?: string; color?: string }
    ): Promise<Written<LabelMutation>> {
      const before = colorOf(await loadLabelSet(content, spaceKey), name);
      const mutation = await updateLabel(content, spaceKey, name, change);
      const renamed = mutation.name !== name.trim();
      const recoloured = change.color !== undefined && change.color !== before;
      const subject = renamed
        ? `${recoloured ? "Rename and recolor" : "Rename"} label ${subjectSafe(name)} to ${subjectSafe(mutation.name)}`
        : `Recolor label ${subjectSafe(mutation.name)}`;
      return record(mutation, mutation.changedFsPaths, `${subject} in ${spaceKey}`);
    },

    /** Remove a label from the palette and from every page in the space that carries it. */
    async deleteLabel(spaceKey: string, name: string): Promise<Written<LabelMutation>> {
      const mutation = await deleteLabel(content, spaceKey, name);
      return record(mutation, mutation.changedFsPaths, `Delete label ${subjectSafe(mutation.name)} in ${spaceKey}`);
    },

    /** Save uploaded images into a space's `_assets/` and commit the ones that saved. */
    async addImages(spaceKey: string, files: readonly File[]): Promise<Written<ImageUpload>> {
      const saved: SavedImage[] = [];
      let saveError: string | undefined;
      for (const file of files) {
        try {
          saved.push(await saveImage(content, spaceKey, file, new Uint8Array(await file.arrayBuffer())));
        } catch (err) {
          saveError = `Could not save ${file.name}: ${errorMessage(err)}`;
          break;
        }
      }
      const subject =
        saved.length === 1
          ? `Add ${git.kbRelPath(saved[0].fsPath)}`
          : `Add ${saved.length} images to ${spaceKey}/_assets`;
      return record({ saved, saveError }, saved.map((image) => image.fsPath), subject);
    },

    /**
     * Delete an image from a space's `_assets/`, unless a page still links to
     * it (`linkedFrom`), which deletes and commits nothing. Null when there is
     * no such image.
     */
    async deleteImage(spaceKey: string, rel: string): Promise<Written<ImageDeletion> | null> {
      const mutation = await deleteImage(content, spaceKey, rel);
      if (!mutation) return null;
      if (mutation.linkedFrom.length) return { mutation, commit: null };
      return record(mutation, [mutation.fsPath], `Delete ${git.kbRelPath(mutation.fsPath)}`);
    },
  };
}

/** A label name as it may appear in a commit subject: one line, whatever was hand-written. */
function subjectSafe(name: string): string {
  return name.replace(/\p{Cc}/gu, " ").trim();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
