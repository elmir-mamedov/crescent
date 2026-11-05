/**
 * The HTML the viewer serves. Each view and the parts it is built from live
 * under views/, one module per feature, each holding its markup together with
 * the browser script that drives it; this module is what the server and the
 * tests import.
 */

export { configureViews } from "./views/config.js";
export { archiveHref, escapeHtml, galleryHref, labelsHref } from "./views/html.js";
export {
  archiveLayout,
  folderLayout,
  layout,
  notFound,
  type ArchiveView,
  type FolderView,
  type PageView,
  type ViewNotice,
} from "./views/page.js";
export { deleteLayout, editLayout, type DeleteView, type EditView } from "./views/edit.js";
export { diffLayout, type DiffView } from "./views/history.js";
export {
  dashboardLayout,
  dashboardsLayout,
  labelsDashboardLayout,
  type DashboardCard,
  type DashboardView,
  type DashboardsView,
  type LabelResult,
  type LabelsDashboardView,
} from "./views/dashboards.js";
export { galleryLayout, type GalleryView } from "./views/gallery.js";
export { spacesLayout, type SpacesView } from "./views/spaces.js";
export { loginLayout, type LoginView } from "./views/login.js";
export { updateGateLayout, type UpdateGateView } from "./views/update-gate.js";
export { DIAGRAM_MODEL } from "./views/diagrams.js";
export { FIND_MODEL } from "./views/find.js";
export { TAB_MODEL } from "./views/tabs.js";
