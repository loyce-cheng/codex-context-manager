using System;
using System.IO;

// Inert dependency for installer integration tests. Never run or ship in the public installer.
class LoaderSetupFixture {
    static int Main(string[] args) {
        var profile=Environment.GetEnvironmentVariable("LENS_QA_PROFILE");
        if(args.Length!=1 || args[0]!="/S" || String.IsNullOrEmpty(profile) || !Path.IsPathRooted(profile))return 2;
        if(Environment.GetEnvironmentVariable("LENS_QA_FAIL")=="1")return 3;
        var root=Path.Combine(profile,"Programs","CodexScriptLoader");
        var bin=Path.Combine(root,"versions","0.6.2","win-x64");
        Directory.CreateDirectory(bin);
        foreach(var path in new[]{Path.Combine(root,"CodexScriptLoader.exe"),Path.Combine(bin,"CodexScriptLoader.exe"),Path.Combine(bin,"CodexScriptLoader.Command.exe")})
            File.WriteAllText(path,"QA: presence only");
        File.WriteAllText(Path.Combine(root,"active.json"),"{\"schemaVersion\":1,\"launcherProtocol\":1,\"handoffProtocol\":1,\"rid\":\"win-x64\",\"entryPoint\":\"CodexScriptLoader.exe\",\"version\":\"0.6.2\"}");
        File.AppendAllText(Path.Combine(profile,"dependency-calls.txt"),"install\n");
        return 0;
    }
}
