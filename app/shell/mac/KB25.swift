// KB25's window on macOS: a native app around one WKWebView, so KB25 has its
// own Dock icon, menu bar and Cmd+Tab entry, and quits like any other app.
//
// KB25.app's Info.plist names the command that starts the server
// (KB25StartCommand): the installer's launcher.mjs, or the developer launcher's
// script. It starts the server unless one already answers and prints the
// server's address, which the window opens. Until its first page has loaded,
// the window stays hidden behind a small loading window (shell/splash.html).
// Closing the window, or Cmd+Q, asks the server to quit with POST
// /_quit?when=idle, which waits for a chat reply still being written. The
// page's power button stops the server itself, which says "quit" on GET
// /_window, and the app quits with it. A restart, as an update does, ends that
// stream without a word, and the app listens again.
//
// Links that leave KB25, and links asked for in a new window, open in the
// default browser. Built by scripts/build-shell.mjs, which adds the loading
// window's page as AppDelegate.splashPage.
import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var titleObservation: NSKeyValueObservation?
  private var server: URL?
  /// The address that last failed to load, which Reload and the retry go back to.
  private var failedURL: URL?
  /// The server quit first (its power button), so there is nothing to stop.
  private var serverQuit = false
  private var downloads: [ObjectIdentifier: URL] = [:]
  private var signalSource: DispatchSourceSignal?
  /// KB25's dark background (--bg in views.ts), its default theme.
  private static let background = NSColor(srgbRed: 13 / 255, green: 17 / 255, blue: 23 / 255, alpha: 1)
  /// The loading window's border (--line in views.ts).
  private static let line = NSColor(srgbRed: 48 / 255, green: 54 / 255, blue: 61 / 255, alpha: 1)
  /// The small loading window, shown until the first page has loaded behind it.
  private var splash: NSWindow?
  private var splashView: WKWebView?
  private var splashLoaded = false
  /// The first page has loaded in the hidden main window.
  private var pageReady = false
  private var readySent = false
  /// The main window has taken over from the loading window.
  private var revealed = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.mainMenu = makeMainMenu()
    makeWindow()
    makeSplash()
    quitOnSIGTERM()
    startServer()
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    if !revealed {
      splash?.orderFrontRegardless()
      return true
    }
    window.makeKeyAndOrderFront(nil)
    return true
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard let server, !serverQuit else { return .terminateNow }
    var request = URLRequest(url: URL(string: "/_quit?when=idle", relativeTo: server)!.absoluteURL, timeoutInterval: 3)
    request.httpMethod = "POST"
    URLSession.shared.dataTask(with: request) { _, _, _ in
      Self.onMainRunLoop { NSApp.reply(toApplicationShouldTerminate: true) }
    }.resume()
    return .terminateLater
  }

  /// Quit from code. Waiting for the server's answer (terminateLater) spins a
  /// nested run loop, which cannot run a main-queue block while another one is
  /// running: quitting from inside one, then answering through another, would
  /// wait forever. Run loop blocks have no such limit.
  private func quit() {
    Self.onMainRunLoop { NSApp.terminate(nil) }
  }

  private static func onMainRunLoop(_ block: @escaping () -> Void) {
    CFRunLoopPerformBlock(CFRunLoopGetMain(), CFRunLoopMode.commonModes.rawValue, block)
    CFRunLoopWakeUp(CFRunLoopGetMain())
  }

  // MARK: Starting

  private func startServer() {
    guard let command = Bundle.main.object(forInfoDictionaryKey: "KB25StartCommand") as? [String],
          let executable = command.first
    else {
      return fail("Crescent.app does not say how to start Crescent. Install Crescent again.")
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = Array(command.dropFirst())
    var environment = ProcessInfo.processInfo.environment
    // The launcher only starts the server; this app is the window.
    environment["KB25_NO_BROWSER"] = "1"
    process.environment = environment
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    process.terminationHandler = { finished in
      // What it printed, not the pipe's end: a server it started may still
      // hold the pipe open, and then the end never comes.
      let printed = finished.terminationStatus == 0 ? output.fileHandleForReading.availableData : Data()
      let text = String(decoding: printed, as: UTF8.self)
      let address = text.split(whereSeparator: \.isNewline).last.map { $0.trimmingCharacters(in: .whitespaces) }
      DispatchQueue.main.async {
        guard finished.terminationStatus == 0, let address, let url = URL(string: address),
              url.scheme == "http" || url.scheme == "https"
        else {
          // The launcher has already said why, in a dialog of its own.
          self.quit()
          return
        }
        self.server = url
        self.webView.load(URLRequest(url: url))
        self.listenForQuit(url)
        // Should the first page never finish, don't keep the main window hidden.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { self.reveal() }
      }
    }
    do {
      try process.run()
    } catch {
      fail("Crescent could not start: \(error.localizedDescription)")
    }
  }

  /// Hear the server quit from its power button. The stream ends without that
  /// when the server restarts, and this listens again once the next one answers.
  private func listenForQuit(_ server: URL) {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 7 * 24 * 3600
    configuration.timeoutIntervalForResource = 7 * 24 * 3600
    let session = URLSession(configuration: configuration)
    let url = URL(string: "/_window", relativeTo: server)!.absoluteURL
    Task {
      while true {
        if let (bytes, response) = try? await session.bytes(from: url),
           (response as? HTTPURLResponse)?.statusCode == 200 {
          do {
            for try await line in bytes.lines where line == "event: quit" {
              await MainActor.run {
                self.serverQuit = true
                self.quit()
              }
              return
            }
          } catch {}
        }
        try? await Task.sleep(nanoseconds: 2_000_000_000)
      }
    }
  }

  /// Logout and `kill` send SIGTERM; quit the way Cmd+Q does, so the server stops too.
  private func quitOnSIGTERM() {
    signal(SIGTERM, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    source.setEventHandler { [weak self] in self?.quit() }
    source.resume()
    signalSource = source
  }

  private func fail(_ message: String) {
    let alert = NSAlert()
    alert.messageText = "Crescent"
    alert.informativeText = message
    alert.runModal()
    quit()
  }

  // MARK: The window

  private func makeWindow() {
    webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsMagnification = true
    if #available(macOS 13.3, *) { webView.isInspectable = true }
    webView.loadHTMLString(Self.page("Starting Crescent…"), baseURL: nil)

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Crescent"
    window.contentView = webView
    window.backgroundColor = Self.background
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    if !window.setFrameUsingName("KB25") { window.center() }
    window.setFrameAutosaveName("KB25")
    titleObservation = webView.observe(\.title) { [weak self] webView, _ in
      let title = webView.title ?? ""
      self?.window.title = title.isEmpty ? "Crescent" : title
    }
    // Shown by reveal(), once the loading window has played the moon.
  }

  private func showWindow() {
    guard !window.isVisible else { return }
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if webView === splashView {
      splashLoaded = true
      showSplash()
      sendReady()
      return
    }
    guard !revealed, let scheme = webView.url?.scheme, scheme == "http" || scheme == "https" else { return }
    pageReady = true
    sendReady()
  }

  /// A message page in KB25's dark colours, for before and between pages.
  private static func page(_ message: String, retry: URL? = nil) -> String {
    let script = retry.map { "<script>setTimeout(() => location.href = \(String(reflecting: $0.absoluteString)), 2000)</script>" } ?? ""
    return """
      <!doctype html><meta name="color-scheme" content="dark">
      <style>html{height:100%;display:grid;place-items:center;background:#0d1117;color:#8b949e;font:15px -apple-system,sans-serif}</style>
      <p>\(message)</p>\(script)
      """
  }

  // MARK: The loading window

  /// A small borderless window in KB25's dark colours: the ticker while the
  /// server starts and the first page loads behind it, then the moon.
  private func makeSplash() {
    let frame = NSRect(x: 0, y: 0, width: 320, height: 220)
    let configuration = WKWebViewConfiguration()
    configuration.userContentController.add(self, name: "splash")
    let view = WKWebView(frame: frame, configuration: configuration)
    view.navigationDelegate = self
    view.autoresizingMask = [.width, .height]
    if #available(macOS 12.0, *) { view.underPageBackgroundColor = Self.background }
    view.loadHTMLString(Self.splashPage, baseURL: nil)

    let container = NSView(frame: frame)
    container.wantsLayer = true
    container.layer?.backgroundColor = Self.background.cgColor
    container.layer?.cornerRadius = 12
    container.layer?.masksToBounds = true
    container.layer?.borderWidth = 1
    container.layer?.borderColor = Self.line.cgColor
    container.addSubview(view)

    let panel = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    panel.title = "Crescent"
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.isReleasedWhenClosed = false
    panel.contentView = container
    panel.center()
    splash = panel
    splashView = view
    // Shown once its page has painted, as an empty web view is white; the
    // timer covers that page never finishing.
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.showSplash() }
  }

  private func showSplash() {
    guard let splash, !revealed, !splash.isVisible else { return }
    splash.orderFrontRegardless()
    splash.invalidateShadow()
    NSApp.activate(ignoringOtherApps: true)
  }

  /// Once both pages have loaded, the loading window plays the moon and then says "done".
  private func sendReady() {
    guard pageReady, splashLoaded, !readySent, !revealed else { return }
    readySent = true
    splashView?.evaluateJavaScript("crescentReady()")
    // Should the page never say so, don't keep the main window hidden.
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.reveal() }
  }

  private func setSplashStatus(_ text: String) {
    guard splashLoaded else { return }
    splashView?.evaluateJavaScript("crescentStatus(\(String(reflecting: text)))")
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "splash", message.body as? String == "done" { reveal() }
  }

  /// Hand over from the loading window to the main one.
  private func reveal() {
    guard !revealed else { return }
    revealed = true
    showWindow()
    splash?.orderOut(nil)
    // Let it go once this turn is over: this may be answering its page's message.
    DispatchQueue.main.async {
      self.splashView?.configuration.userContentController.removeScriptMessageHandler(forName: "splash")
      self.splash = nil
      self.splashView = nil
    }
  }

  // MARK: Links and downloads

  private func isKB25(_ url: URL) -> Bool {
    switch url.scheme {
    case "about", "data", "blob":
      return true
    case "http", "https":
      guard let server else { return false }
      return url.host == server.host && url.port == server.port
    default:
      return false
    }
  }

  /// Hand an address to the default browser or mail app. Only these schemes: a
  /// page's file: link would otherwise open, or run, whatever it names.
  private func openElsewhere(_ url: URL) {
    guard ["http", "https", "mailto"].contains(url.scheme ?? "") else { return }
    NSWorkspace.shared.open(url)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    if action.shouldPerformDownload { return decisionHandler(.download) }
    let mainFrame = action.targetFrame?.isMainFrame ?? true
    let newWindow = action.modifierFlags.contains(.command) || action.buttonNumber == 2
    if (action.navigationType == .linkActivated && newWindow) || (mainFrame && !isKB25(url)) {
      openElsewhere(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  /// window.open and target=_blank: the default browser, not a second window here.
  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for action: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = action.request.url { openElsewhere(url) }
    return nil
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    let attachment = disposition.lowercased().hasPrefix("attachment")
    decisionHandler(!response.canShowMIMEType || attachment ? .download : .allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  /// Into Downloads, as a browser would, under a name not taken yet.
  func download(
    _ download: WKDownload,
    decideDestinationUsing response: URLResponse,
    suggestedFilename: String,
    completionHandler: @escaping (URL?) -> Void
  ) {
    let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = (suggestedFilename as NSString).lastPathComponent
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension
    var candidate = folder.appendingPathComponent(name.isEmpty ? "download" : name)
    var n = 2
    while FileManager.default.fileExists(atPath: candidate.path) {
      candidate = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
      n += 1
    }
    downloads[ObjectIdentifier(download)] = candidate
    completionHandler(candidate)
  }

  /// Bounce the Downloads stack in the Dock, the way Safari shows a finished download.
  func downloadDidFinish(_ download: WKDownload) {
    guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    DistributedNotificationCenter.default().post(
      name: Notification.Name("com.apple.DownloadFileFinished"),
      object: file.path
    )
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    downloads.removeValue(forKey: ObjectIdentifier(download))
  }

  // MARK: Loading

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    if webView.url?.scheme != "about" { failedURL = nil }
  }

  /// The server is not answering: say so, and keep trying, since an update
  /// restarting it is the usual reason.
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    guard webView !== splashView else { return }
    let error = error as NSError
    // Cancelled by this app (a link handed on, a download): nothing failed.
    if error.code == NSURLErrorCancelled || (error.domain == "WebKitErrorDomain" && error.code == 102) { return }
    guard let url = error.userInfo[NSURLErrorFailingURLErrorKey] as? URL, isKB25(url) else { return }
    failedURL = url
    if !revealed { setSplashStatus("Crescent isn’t answering. Trying again…") }
    webView.loadHTMLString(Self.page("Crescent isn’t answering. Trying again…", retry: url), baseURL: nil)
  }

  // MARK: Menus

  @objc func reloadPage(_ sender: Any?) {
    if let failedURL {
      webView.load(URLRequest(url: failedURL))
    } else {
      webView.reload()
    }
  }

  @objc func goBack(_ sender: Any?) { webView.goBack() }
  @objc func goForward(_ sender: Any?) { webView.goForward() }
  @objc func actualSize(_ sender: Any?) { webView.pageZoom = 1 }
  @objc func zoomIn(_ sender: Any?) { webView.pageZoom = min(webView.pageZoom + 0.1, 3) }
  @objc func zoomOut(_ sender: Any?) { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }

  private func makeMainMenu() -> NSMenu {
    let main = NSMenu()
    func item(
      _ title: String,
      _ action: Selector?,
      _ key: String = "",
      _ modifiers: NSEvent.ModifierFlags = .command,
      tag: Int = 0
    ) -> NSMenuItem {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
      item.keyEquivalentModifierMask = modifiers
      item.tag = tag
      return item
    }
    @discardableResult
    func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
      let menu = NSMenu(title: title)
      items.forEach(menu.addItem)
      let holder = NSMenuItem()
      holder.submenu = menu
      main.addItem(holder)
      return menu
    }
    let find = #selector(NSResponder.performTextFinderAction(_:))
    submenu("Crescent", [
      item("About Crescent", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Hide Crescent", #selector(NSApplication.hide(_:)), "h"),
      item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit Crescent", #selector(NSApplication.terminate(_:)), "q"),
    ])
    // No Cmd+E here: the page uses it to open the editor.
    submenu("Edit", [
      item("Undo", Selector(("undo:")), "z"),
      item("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"),
      item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Paste and Match Style", #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift]),
      item("Select All", #selector(NSText.selectAll(_:)), "a"),
      .separator(),
      item("Find…", find, "f", tag: NSTextFinder.Action.showFindInterface.rawValue),
      item("Find Next", find, "g", tag: NSTextFinder.Action.nextMatch.rawValue),
      item("Find Previous", find, "g", [.command, .shift], tag: NSTextFinder.Action.previousMatch.rawValue),
    ])
    submenu("View", [
      item("Reload Page", #selector(reloadPage(_:)), "r"),
      .separator(),
      item("Actual Size", #selector(actualSize(_:)), "0"),
      item("Zoom In", #selector(zoomIn(_:)), "="),
      item("Zoom Out", #selector(zoomOut(_:)), "-"),
      .separator(),
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    submenu("History", [
      item("Back", #selector(goBack(_:)), "["),
      item("Forward", #selector(goForward(_:)), "]"),
    ])
    NSApp.windowsMenu = submenu("Window", [
      item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:))),
      .separator(),
      item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))),
    ])
    return main
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
