using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// Build into one disposable fixture directory. The desktop CLI selector on
// Windows expects an executable. The Node entry point owns the stdio protocol.
internal static class FixtureCli
{
    private static async Task Pump(Stream input, Stream output)
    {
        byte[] bytes = new byte[16384];
        int count;
        while ((count = await input.ReadAsync(bytes, 0, bytes.Length)) != 0)
        {
            await output.WriteAsync(bytes, 0, count);
            await output.FlushAsync();
        }
    }

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? 2 * slashes + 1 : slashes);
            result.Append(c);
            slashes = 0;
        }
        return result.Append('\\', 2 * slashes).Append('"').ToString();
    }

    private static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        if (!String.Equals(Path.Combine(dir, "home"), Environment.GetEnvironmentVariable("CODEX_HOME"), StringComparison.OrdinalIgnoreCase)
            || !String.Equals(Path.Combine(dir, "electron"), Environment.GetEnvironmentVariable("CODEX_ELECTRON_USER_DATA_PATH"), StringComparison.OrdinalIgnoreCase))
        {
            File.AppendAllText(Path.Combine(dir, "entry-events.txt"), "profile-mismatch\n");
            // The desktop may rebuild the child environment. Only the supervising
            // probe can attest that this exact process descends from its isolated
            // desktop. An absent marker is never permission to use a default home.
            string marker = Path.Combine(dir, "allow-" + Process.GetCurrentProcess().Id + ".fixture");
            var wait = Stopwatch.StartNew();
            while (!File.Exists(marker) && wait.ElapsedMilliseconds < 15000) Thread.Sleep(50);
            if (!File.Exists(marker)) return 64;
            File.Delete(marker);
            Environment.SetEnvironmentVariable("CODEX_HOME", Path.Combine(dir, "home"));
            Environment.SetEnvironmentVariable("CODEX_ELECTRON_USER_DATA_PATH", Path.Combine(dir, "electron"));
        }
        File.AppendAllText(Path.Combine(dir, "entry-events.txt"), args.Contains("app-server") ? "server\n" : "other\n");
        string[] entry = File.ReadAllLines(Path.Combine(dir, "node-entry.txt"));
        var start = new ProcessStartInfo(entry[0],
            String.Join(" ", new[] { entry[1], dir }.Concat(args).Select(Quote)))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true };
        using (var child = Process.Start(start))
        {
            var output = Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
            Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream)
                .ContinueWith(_ => { try { child.StandardInput.Close(); } catch (IOException) { } });
            child.WaitForExit();
            output.GetAwaiter().GetResult();
            return child.ExitCode;
        }
    }
}
