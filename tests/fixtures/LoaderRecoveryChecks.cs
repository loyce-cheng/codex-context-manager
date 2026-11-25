using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

// Compile with LoaderRecovery.cs and /main:LoaderRecoveryChecks in a scratch directory.
// Only this test executable redirects the instance file and uses a unique local pipe.
internal static class LoaderRecoveryChecks {
    static void Require(bool pass) { if (!pass) throw new Exception("Recovery regression"); }
    static void ExpectRefusal(string reason) {
        try {
            typeof(LoaderRecovery).GetMethod("ConfirmOwner", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, null);
            throw new Exception("Unexpectedly accepted an invalid instance");
        } catch (TargetInvocationException error) { Require(error.InnerException.Message.Contains(reason)); }
    }
    static int Main() {
        try { Run(); return 0; }
        catch (Exception error) {
            Console.Error.WriteLine(error.GetType().Name + " " + error.Message);
            return 1;
        }
    }
    static void Run() {
        string pipe = "lens-isolated-test-" + Guid.NewGuid().ToString("N");
        Console.WriteLine("Checking the isolated ShowStatus pipe.");
        using (var server = new NamedPipeServerStream(pipe, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous)) {
            var received = Task.Run(async () => {
                await server.WaitForConnectionAsync();
                using (var reader = new StreamReader(server)) return await reader.ReadLineAsync();
            });
            LoaderRecovery.RequestDiagnostics(pipe);
            Require(received.Wait(3000) && received.Result == "ShowStatus");
        }
        Console.WriteLine("Checking a missing pipe.");
        try { LoaderRecovery.RequestDiagnostics(pipe); throw new Exception("Accepted a missing pipe"); }
        catch (TimeoutException) { }
        string lockFile=Path.GetTempFileName();
        Console.WriteLine("Checking the isolated Loader lock.");
        try {
            typeof(LoaderRecovery).GetField("LockPath", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null,lockFile);
            ExpectRefusal("已释放");
            using (var locked=File.Open(lockFile, FileMode.Open, FileAccess.ReadWrite, FileShare.Read)) {
                ExpectRefusal("无法核对");
                using (var self=Process.GetCurrentProcess()) {
                    var record="protocol=3;pid="+self.Id+";started="+DateTimeOffset.UtcNow.AddMinutes(-10).ToString("O");
                    int pid; DateTimeOffset time;
                    Require(LoaderRecovery.ReadOwner(record,out pid,out time) && pid==self.Id);
                    Require(!LoaderRecovery.ReadOwner(record.Replace("protocol=3","protocol=99"),out pid,out time));
                    var bytes=Encoding.UTF8.GetBytes(record);
                    locked.Write(bytes,0,bytes.Length); locked.Flush();
                    ExpectRefusal("实例已切换");
                    Require(!self.HasExited);
                }
            }
        } finally { File.Delete(lockFile); }
        Console.WriteLine("Recovery checks passed: ShowStatus wire format, missing pipe, released lock, malformed lock, version and PID reuse.");
    }
}
