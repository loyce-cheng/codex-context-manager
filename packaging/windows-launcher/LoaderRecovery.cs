using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

// Standalone so an older installation can be repaired even while its files are in use.
internal static class LoaderRecovery {
    static readonly string LockPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        @"CodexScriptLoader\state\instance.v0.3.lock");
    const string StockHost = "b0382fde6389ede1843a77848d2cfaff009952cde41d22da063f98fecc3c3e18";
    const string ExperimentalHost = "a5e733630508e51a1e3088c91b8ca2a834e1e3462dff9e66bb52bac6def374a3";

    static string Hash(Stream stream) {
        using (var sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    internal static void RequestDiagnostics(string pipeName) {
        using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.Out,
                PipeOptions.Asynchronous, TokenImpersonationLevel.Identification)) {
            pipe.Connect(1400);
            byte[] command = Encoding.ASCII.GetBytes("ShowStatus\n");
            if (!pipe.WriteAsync(command, 0, command.Length).Wait(1600))
                throw new TimeoutException("Loader 管理通道未接收请求。");
        }
    }

    internal static string UserPipe(string sid) {
        using (var bytes = new MemoryStream(Encoding.UTF8.GetBytes(sid)))
            return "CodexScriptLoader.v0.3." + Hash(bytes).Substring(0, 24);
    }

    internal static bool ReadOwner(string record, out int pid, out DateTimeOffset claimed) {
        var match = Regex.Match(record, @"\Aprotocol=3;pid=(\d{1,10});started=([^;\r\n]{20,40})\z");
        pid = 0;
        claimed = default(DateTimeOffset);
        return match.Success && int.TryParse(match.Groups[1].Value, out pid) && pid > 0 &&
            DateTimeOffset.TryParseExact(match.Groups[2].Value, "O", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out claimed);
    }

    static Process ConfirmOwner() {
        int pid;
        DateTimeOffset claimed;
        string record;
        // An unlocked file remains after a normal exit. Only a currently held lock counts.
        try {
            using (File.Open(LockPath, FileMode.Open, FileAccess.Read, FileShare.Read)) { }
            throw new InvalidOperationException("Loader 已释放实例锁，可以重新打开快捷方式。");
        } catch (IOException error) {
            if ((error.HResult & 65535) != 32) throw;
        }
        using (var input = new FileStream(LockPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
            if (input.Length > 256) throw new InvalidDataException("Loader 实例记录异常。");
            using (var reader = new StreamReader(input)) record = reader.ReadToEnd();
        }
        if (!ReadOwner(record, out pid, out claimed)) throw new InvalidDataException("无法核对 Loader 的实例记录。");
        var p = Process.GetProcessById(pid);
        try {
            // Pin the process object before checking identity and keep it through confirmation.
            var handle = p.Handle;
            using (var self = Process.GetCurrentProcess())
                if (p.SessionId != self.SessionId) throw new InvalidOperationException("Loader 属于其他登录会话。");
            if (p.StartTime.ToUniversalTime() > claimed.UtcDateTime || claimed > DateTimeOffset.UtcNow.AddSeconds(-30))
                throw new InvalidOperationException("Loader 实例已切换或仍在启动，请稍后重试。");
            string path = p.MainModule.FileName;
            if (!String.Equals(Path.GetFileName(path), "CodexScriptLoader.exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("实例记录已过期。");
            using (var exe = File.OpenRead(path)) {
                string digest = Hash(exe);
                if (digest != StockHost && digest != ExperimentalHost)
                    throw new InvalidOperationException("这个 Loader 构建仅支持从原生诊断窗口退出。");
            }
            return p;
        } catch { p.Dispose(); throw; }
    }

    static void RequireDesktopClosed() {
        using (var self = Process.GetCurrentProcess()) {
            foreach (var name in new [] { "ChatGPT", "Codex" }) {
                foreach (var process in Process.GetProcessesByName(name)) using (process) {
                    try {
                        if (process.HasExited || process.SessionId != self.SessionId) continue;
                        string path = process.MainModule.FileName;
                        // Packaged CLI tools live below app/resources; the desktop lives directly in app.
                        if (name == "ChatGPT" || !Regex.IsMatch(path,
                            @"\\(?:app\\resources|experimental-backend-[^\\]+)\\codex\.exe$", RegexOptions.IgnoreCase))
                            throw new IOException("请保存工作并完全退出所有 Codex 桌面窗口，稍后再试。");
                    } catch (InvalidOperationException) { if (!process.HasExited) throw; }
                }
            }
        }
    }

    static string FriendlyError(Exception error) {
        if (error is FileNotFoundException || error is DirectoryNotFoundException || error is ArgumentException)
            return "没有找到可确认的 Loader 实例。可以重新打开 Context Lens 快捷方式。";
        return error.Message;
    }

    [STAThread]
    static int Main() {
        Application.EnableVisualStyles();
        using (var window = new Form { Text="Context Lens · 恢复 Loader", ClientSize=new System.Drawing.Size(452,155),
                StartPosition=FormStartPosition.CenterScreen, FormBorderStyle=FormBorderStyle.FixedDialog, MaximizeBox=false }) {
            var note = new Label { Left=16, Top=16, Width=420, Height=70,
                Text="从 Loader 诊断窗口点击 Exit Loader，然后重新打开 Context Lens 快捷方式。" };
            var open = new Button { Left=16, Top=99, Width=185, Height=32, Text="打开 Loader 诊断" };
            var end = new Button { Left=211, Top=99, Width=215, Height=32, Text="结束残留的 Loader…" };
            window.Controls.AddRange(new Control[] { note, open, end });
            open.Click += async (sender, args) => {
                open.Enabled=end.Enabled=false;
                try {
                    string pipe;
                    using (var identity=WindowsIdentity.GetCurrent()) pipe=UserPipe(identity.User.Value);
                    await Task.Run(() => RequestDiagnostics(pipe));
                    note.Text="已发送打开诊断窗口的请求。请在该窗口点击 Exit Loader。如果窗口一直没有出现，退出 Codex 后可选择结束残留的 Loader。";
                } catch (Exception) { note.Text="Loader 的管理通道没有响应。如果已退出 Codex，可以选择结束残留的 Loader。"; }
                finally { if (!window.IsDisposed) open.Enabled=end.Enabled=true; }
            };
            end.Click += async (sender, args) => {
                open.Enabled=end.Enabled=false;
                try {
                    RequireDesktopClosed();
                    using (var original=ConfirmOwner()) {
                        if (MessageBox.Show(window, "结束已核对的 Loader 进程（PID " + original.Id +
                            "）？该实例加载的所有插件都会停止。", "恢复 Loader", MessageBoxButtons.YesNo,
                            MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
                        await Task.Delay(2000);
                        if (window.IsDisposed) return;
                        if (!original.HasExited) {
                            using (var current=ConfirmOwner()) {
                                if (current.Id != original.Id) throw new IOException("Loader 实例已切换，请重新检查。");
                                RequireDesktopClosed();
                                original.Kill();
                                if (!original.WaitForExit(3000)) throw new IOException("Loader 尚未退出。");
                            }
                        }
                        note.Text="该 Loader 实例已退出。现在可以重新打开 Context Lens 快捷方式。";
                    }
                } catch (Exception error) { note.Text=FriendlyError(error); }
                finally { if (!window.IsDisposed) open.Enabled=end.Enabled=true; }
            };
            window.Shown += (sender, args) => open.PerformClick();
            Application.Run(window);
        }
        return 0;
    }
}
