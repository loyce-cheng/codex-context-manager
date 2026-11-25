using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace CodexScriptLoader.Interop;

// Opt-in startup for the locally built backend. Loader retains its own argument
// construction, package identity checks and supervision of the returned PID.
public static class DesktopAliasActivation
{
    // The supervisor can discover a different package after an in-app update.
    public static bool SupportsVersion(Version version) => version == new Version(26, 1117, 4957, 0);

    public static bool TryActivate(string appUserModelId, IReadOnlyList<string> arguments, out int pid)
    {
        pid = 0;
        if (Environment.GetEnvironmentVariable("CONTEXT_LENS_DESKTOP_TIERS") != "1" ||
            appUserModelId != "OpenAI.Codex_2p2nqsd0c76g0!App" || arguments.Count == 0)
            return false;

        string cli = Environment.GetEnvironmentVariable("CODEX_CLI_PATH") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(cli) || !Path.IsPathFullyQualified(cli) || !File.Exists(cli))
            throw new InvalidOperationException("The selected experimental Codex CLI is unavailable.");

        string alias = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Microsoft", "WindowsApps", "OpenAI.Codex_2p2nqsd0c76g0", "chatgpt-desktop.exe");
        var start = new ProcessStartInfo(alias) { UseShellExecute = false };
        foreach (string argument in arguments)
            start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Codex activation failed.");
        pid = process.Id;
        return true;
    }
}
