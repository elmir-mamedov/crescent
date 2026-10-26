// KB25's window on Windows: a native app around one WebView2, so KB25 has its
// own taskbar button and icon, and quits like any other app.
//
// KB25.exe lives in <KB25_HOME>\shell\<version>\, outside app\, which an update
// replaces while the window is open. It runs the installer's launcher.mjs,
// which starts the server unless one already answers and prints the server's
// address, and opens that address. Closing the window asks the server to quit
// with POST /_quit?when=idle, which waits for a chat reply still being written.
// The page's power button stops the server itself, which says "quit" on GET
// /_window, and the window closes with it. A restart, as an update does, ends
// that stream without a word, and the window listens again.
//
// Links that leave KB25, and links asked for in a new window, open in the
// default browser. Opening KB25 again brings this window forward. Built by
// scripts/build-shell.mjs.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace KB25
{
    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool AllowSetForegroundWindow(int processId);

        [STAThread]
        static void Main()
        {
            using (var mutex = new Mutex(true, @"Local\KB25-window", out bool first))
            using (var show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\KB25-show"))
            {
                if (!first)
                {
                    // Windows lets only the app in front take focus; this one is.
                    AllowSetForegroundWindow(-1);
                    show.Set();
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var home = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
                Application.Run(new KB25Window(home, show));
            }
        }
    }

    sealed class KB25Window : Form
    {
        readonly string home;
        // KB25's dark background (--bg in views.ts), its default theme, so the
        // window is never white before the first page paints.
        static readonly Color Background = Color.FromArgb(0x0d, 0x11, 0x17);
        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Background };
        readonly HttpClient http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        Uri server;
        Uri requested;
        // The server quit first (its power button), so there is nothing to stop.
        bool serverQuit;

        string BoundsFile => Path.Combine(home, "window-bounds.txt");

        public KB25Window(string home, EventWaitHandle show)
        {
            this.home = home;
            Text = "Crescent";
            BackColor = Background;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Size = new Size(1280, 860);
            StartPosition = FormStartPosition.CenterScreen;
            RestoreSavedBounds();
            Controls.Add(web);
            Load += async (sender, e) => await StartAsync();
            FormClosing += OnClosing;
            var listener = new Thread(() =>
            {
                while (show.WaitOne())
                {
                    try { BeginInvoke((Action)BringForward); } catch (InvalidOperationException) { }
                }
            });
            listener.IsBackground = true;
            listener.Start();
        }

        async Task StartAsync()
        {
            try
            {
                // Its own data folder, beside the install, so pages keep their
                // settings across updates.
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(home, "webview"));
                await web.EnsureCoreWebView2Async(environment);
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show(
                    "Crescent needs the Microsoft Edge WebView2 Runtime for its window, so it opens in your browser instead.",
                    "Crescent");
                var address = await Task.Run(() => StartServer());
                if (address != null) OpenElsewhere(new Uri(address));
                // The server keeps running for the browser, until its power button.
                serverQuit = true;
                Close();
                return;
            }

            var core = web.CoreWebView2;
            core.DocumentTitleChanged += (sender, e) =>
                Text = string.IsNullOrEmpty(core.DocumentTitle) ? "Crescent" : core.DocumentTitle;
            core.NavigationStarting += OnNavigationStarting;
            core.NavigationCompleted += OnNavigationCompleted;
            core.NewWindowRequested += (sender, e) =>
            {
                // window.open, target=_blank, Ctrl-click: the default browser.
                e.Handled = true;
                if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) OpenElsewhere(uri);
            };
            core.NavigateToString(Page("Starting Crescent…"));

            var started = await Task.Run(() => StartServer());
            if (started == null)
            {
                // The launcher has already said why, in a dialog of its own.
                serverQuit = true;
                Close();
                return;
            }
            server = new Uri(started);
            core.Navigate(started);
            await ListenForQuitAsync();
        }

        /// <summary>Run the launcher; the server's address, or null if it failed.</summary>
        string StartServer()
        {
            var start = new ProcessStartInfo(
                Path.Combine(home, "node", "node.exe"),
                "\"" + Path.Combine(home, "app", "installer", "launcher.mjs") + "\"")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true,
                WorkingDirectory = home,
            };
            // The launcher only starts the server; this app is the window.
            start.EnvironmentVariables["KB25_NO_BROWSER"] = "1";
            using (var process = Process.Start(start))
            {
                // Read what it printed once it has exited, never to the pipe's
                // end: the server it started inherits the pipe and keeps it open.
                process.WaitForExit();
                if (process.ExitCode != 0) return null;
                var line = process.StandardOutput.ReadLine()?.Trim();
                return Uri.TryCreate(line, UriKind.Absolute, out var uri) && (uri.Scheme == "http" || uri.Scheme == "https")
                    ? line
                    : null;
            }
        }

        /// <summary>Hear the server quit from its power button.</summary>
        async Task ListenForQuitAsync()
        {
            var url = new Uri(server, "/_window");
            while (!IsDisposed)
            {
                try
                {
                    using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                    using (var reader = new StreamReader(await response.Content.ReadAsStreamAsync()))
                    {
                        string line;
                        while (response.IsSuccessStatusCode && (line = await reader.ReadLineAsync()) != null)
                        {
                            if (line != "event: quit") continue;
                            serverQuit = true;
                            Close();
                            return;
                        }
                    }
                }
                catch (Exception) { }
                // It restarted (an update) or is not up yet: listen again.
                await Task.Delay(2000);
            }
        }

        bool IsKB25(Uri uri)
        {
            if (uri.Scheme == "about" || uri.Scheme == "data" || uri.Scheme == "blob") return true;
            return server != null
                && (uri.Scheme == "http" || uri.Scheme == "https")
                && uri.Host == server.Host
                && uri.Port == server.Port;
        }

        /// <summary>
        /// Hand an address to the default browser or mail app. Only these schemes:
        /// a page's file: link would otherwise open, or run, whatever it names.
        /// </summary>
        static void OpenElsewhere(Uri uri)
        {
            if (uri.Scheme != "http" && uri.Scheme != "https" && uri.Scheme != "mailto") return;
            try
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
            catch (Exception) { }
        }

        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
            if (IsKB25(uri))
            {
                if (uri.Scheme == "http" || uri.Scheme == "https") requested = uri;
                return;
            }
            e.Cancel = true;
            OpenElsewhere(uri);
        }

        /// <summary>
        /// The server is not answering: say so, and keep trying, since an update
        /// restarting it is the usual reason.
        /// </summary>
        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess || requested == null) return;
            if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            web.CoreWebView2.NavigateToString(Page("Crescent isn’t answering. Trying again…", requested));
        }

        void OnClosing(object sender, FormClosingEventArgs e)
        {
            SaveBounds();
            if (serverQuit || server == null) return;
            try
            {
                Task.Run(() => http.PostAsync(new Uri(server, "/_quit?when=idle"), new StringContent("")))
                    .Wait(TimeSpan.FromSeconds(3));
            }
            catch (Exception) { }
        }

        void BringForward()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        /// <summary>A message page in KB25's dark colours, for before and between pages.</summary>
        static string Page(string message, Uri retry = null)
        {
            var script = retry == null
                ? ""
                : "<script>setTimeout(() => location.href = " + JsonString(retry.AbsoluteUri) + ", 2000)</script>";
            return "<!doctype html><meta charset=\"utf-8\"><meta name=\"color-scheme\" content=\"dark\">"
                + "<style>html{height:100%;display:grid;place-items:center;background:#0d1117;color:#8b949e;font:15px 'Segoe UI',sans-serif}</style>"
                + "<p>" + message + "</p>" + script;
        }

        static string JsonString(string value) =>
            "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("<", "\\u003c") + "\"";

        void RestoreSavedBounds()
        {
            try
            {
                var parts = File.ReadAllText(BoundsFile).Split(',').Select(int.Parse).ToArray();
                var bounds = new Rectangle(parts[0], parts[1], parts[2], parts[3]);
                // Only onto a screen still there: a window off every screen cannot be found.
                if (!Screen.AllScreens.Any(screen => screen.WorkingArea.IntersectsWith(bounds))) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = bounds;
                if (parts.Length > 4 && parts[4] == 1) WindowState = FormWindowState.Maximized;
            }
            catch (Exception) { }
        }

        void SaveBounds()
        {
            try
            {
                var bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                var maximized = WindowState == FormWindowState.Maximized ? 1 : 0;
                File.WriteAllText(BoundsFile, $"{bounds.X},{bounds.Y},{bounds.Width},{bounds.Height},{maximized}");
            }
            catch (Exception) { }
        }
    }
}
