using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Reflection;
using System.Runtime.InteropServices;

// A windowless launcher, not a Codex patch. It only starts our local Node helper.
internal static class ContextLensLauncher {
    static string DefaultRoot() { return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","..")); }
    static void OpenRecovery() {
        try {
            string path=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Context-Lens-Recovery.exe");
            using(var process=Process.Start(new ProcessStartInfo(path){UseShellExecute=false})) {}
        } catch(Exception error){MessageBox.Show(error.Message,"Context Lens");}
    }
    static void InstallShortcuts(string root,bool experimental) {
        string target=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,experimental?"Context-Lens-Experimental.exe":"Context-Lens.exe");
        string name=experimental?"Codex + Context Lens（实验扩容）":"Codex + Context Lens";
        string[] locations={Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Environment.GetFolderPath(Environment.SpecialFolder.Programs)};
        object shell=Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell",true));
        try {
            // Check both destinations before writing. Preserve unrelated shortcuts.
            foreach(string directory in locations) {
                string path=Path.Combine(directory,name+".lnk");
                if(!File.Exists(path))continue;
                object link=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{path});
                try {
                    string existing=(string)link.GetType().InvokeMember("TargetPath",BindingFlags.GetProperty,null,link,null);
                    if(!String.Equals(Path.GetFullPath(existing),target,StringComparison.OrdinalIgnoreCase))
                        throw new Exception("已存在同名快捷方式且指向其他位置，请先手动重命名："+path);
                } finally {Marshal.ReleaseComObject(link);}
            }
            foreach(string directory in locations) {
                Directory.CreateDirectory(directory);
                object link=shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[]{Path.Combine(directory,name+".lnk")});
                try {
                    var type=link.GetType();
                    type.InvokeMember("TargetPath",BindingFlags.SetProperty,null,link,new object[]{target});
                    type.InvokeMember("Arguments",BindingFlags.SetProperty,null,link,new object[]{Quote(root)});
                    type.InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,link,new object[]{root});
                    type.InvokeMember("Description",BindingFlags.SetProperty,null,link,new object[]{experimental?"在 Codex 原对话内按档位调整上下文容量":"启动 Codex 与 Context Lens 左栏监控"});
                    string icon=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","CodexScriptLoader","CodexScriptLoader.exe");
                    if(File.Exists(icon))type.InvokeMember("IconLocation",BindingFlags.SetProperty,null,link,new object[]{icon+",0"});
                    type.InvokeMember("Save",BindingFlags.InvokeMethod,null,link,null);
                } finally {Marshal.ReleaseComObject(link);}
            }
        } finally {Marshal.ReleaseComObject(shell);}
    }
    static string Quote(string value) {
        var result=new StringBuilder("\"");int slashes=0;
        foreach(char c in value){
            if(c=='\\'){slashes++;continue;}
            result.Append('\\',c=='"'?slashes*2+1:slashes);result.Append(c);slashes=0;
        }
        result.Append('\\',slashes*2);result.Append('"');return result.ToString();
    }
    [STAThread]
    static int Main(string[] args) {
        bool check = Array.IndexOf(args,"--check")>=0;
        bool quiet = Array.IndexOf(args,"--quiet")>=0;
        bool status = Array.IndexOf(args,"--status")>=0 ||
            String.Equals(Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location),"Context-Lens-Status",StringComparison.OrdinalIgnoreCase);
        bool install=Array.IndexOf(args,"--install-shortcuts")>=0 ||
            String.Equals(Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location),"Install-Context-Lens",StringComparison.OrdinalIgnoreCase);
        if(args.Length>2||check&&install||status&&(install||check)) return 2;
        foreach(string arg in args)if(arg.StartsWith("--")&&arg!="--check"&&arg!="--quiet"&&arg!="--install-shortcuts"&&arg!="--status")return 2;
        bool owns;
        int exitCode=1;string notice=null;
        using(var mutex=new Mutex(true,status?"Local\\ContextLensStatus":"Local\\ContextLensQuietLauncher",out owns)) {
            if(!owns) {
                if(!check&&!quiet) MessageBox.Show("Context Lens 的启动检查仍在进行，请稍候。","Context Lens",MessageBoxButtons.OK,MessageBoxIcon.Information);
                return 3;
            }
            try {
                string root=args.Length>0&&!args[0].StartsWith("--")?Path.GetFullPath(args[0]):DefaultRoot();
                string manifest=File.ReadAllText(Path.Combine(root,"package.json"));
                Match version=Regex.Match(manifest,"\"version\"\\s*:\\s*\"([0-9A-Za-z.+-]+)\"");
                if(!version.Success) throw new Exception("无法确定项目运行时版本。");
                string node=Path.Combine(root,"dist","context-lens-"+version.Groups[1].Value+"-win32-x64","plugins","context-lens","runtime","node.exe");
                bool experimental=String.Equals(Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location),"Context-Lens-Experimental",StringComparison.OrdinalIgnoreCase);
                string script=status?Path.Combine(root,"scripts","sidebar-status.mjs"):experimental?Path.Combine(root,"experiments","desktop-context-window","launch-desktop.mjs"):Path.Combine(root,"scripts","launch-sidebar.mjs");
                if(!File.Exists(node)||!File.Exists(script)) throw new Exception("启动文件不完整，请保留完整的 Context Lens 项目目录。");
                if(install){InstallShortcuts(root,experimental);notice=experimental?"已创建实验扩容的桌面与开始菜单入口。":"已创建桌面与开始菜单入口：Codex + Context Lens。";exitCode=0;}
                else {
                var messages=new StringBuilder();
                var errors=new StringBuilder();
                bool interactiveWait=experimental&&!check&&!quiet&&!status;
                var info=new ProcessStartInfo(node,Quote(script)+(check?" --check":interactiveWait?" --interactive-wait":"")) {
                    WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,
                    WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=interactiveWait,
                    StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8
                };
                info.EnvironmentVariables["LOCALAPPDATA"]=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                using(var child=new Process {StartInfo=info}) {
                    Form progress=null;Label label=null;
                    if(!check&&!quiet) {
                        Application.EnableVisualStyles();
                        progress=new Form {Text=status?"Context Lens · 查看状态":experimental?"Codex + Context Lens（实验扩容）":"Codex + Context Lens",Width=450,Height=190,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
                        label=new Label {Left=18,Top=18,Width=405,Height=65,Text="正在启动并检查上下文监控…"};
                        if(interactiveWait)progress.FormClosing+=(sender,e)=>{
                            if(e.CloseReason!=CloseReason.UserClosing)return;
                            try{child.StandardInput.Close();}catch(InvalidOperationException){}catch(IOException){}
                        };
                        progress.Controls.Add(label);
                        progress.Controls.Add(new ProgressBar {Left=18,Top=label.Bottom+4,Width=395,Height=16,Style=ProgressBarStyle.Marquee});
                        var recover=new Button {Left=status?18:120,Top=label.Bottom+28,Width=120,Text="恢复 Loader…"};
                        recover.Click+=(sender,e)=>OpenRecovery();
                        progress.Controls.Add(recover);
                        if(status)label.Text="正在查询左栏的实时状态…";
                        else {
                            var inspect=new Button {Left=18,Top=label.Bottom+28,Width=90,Text="查看状态"};
                            inspect.Click+=(sender,e)=>{
                                try{using(var query=Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,Quote(root)+" --status"){UseShellExecute=false})){}}
                                catch(Exception error){MessageBox.Show(error.Message,"Context Lens");}
                            };
                            progress.Controls.Add(inspect);
                        }
                        progress.FormClosing+=(sender,e)=>{e.Cancel=true;progress.Hide();};
                        progress.Show();
                    }
                    DataReceivedEventHandler record=(sender,e)=>{if(e.Data!=null)lock(messages){if(messages.Length<12000)messages.AppendLine(e.Data);}};
                    child.OutputDataReceived+=(sender,e)=>{
                        record(sender,e);
                        if(e.Data!=null&&e.Data.StartsWith("[notice] "))notice=e.Data.Substring(9);
                        if(e.Data!=null&&e.Data.StartsWith("[progress] ")&&progress!=null&&!progress.IsDisposed)
                            try{progress.BeginInvoke(new Action(()=>{if(!label.IsDisposed)label.Text=e.Data.Substring(11);}));}catch(InvalidOperationException){}
                    };
                    child.ErrorDataReceived+=(sender,e)=>{record(sender,e);if(e.Data!=null&&errors.Length<6000)errors.AppendLine(e.Data);};
                    try {
                        child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();
                        while(!child.WaitForExit(100)) {if(progress!=null)Application.DoEvents();}
                        child.WaitForExit(); // Drain async stdout/stderr before persisting the result.
                    } finally {if(progress!=null)progress.Dispose();}
                    if(!status){
                        string dir=Path.Combine(root,".research");Directory.CreateDirectory(dir);
                        File.WriteAllText(Path.Combine(dir,"launcher-last-result.txt"),messages.ToString(),Encoding.UTF8);
                    }
                    if(child.ExitCode!=0) notice=errors.Length>0?errors.ToString():(status?"状态查询未完成，请稍后再试。":"启动未完成，详情已保存到 .research/launcher-last-result.txt。");
                    exitCode=child.ExitCode;
                }
                }
            }catch(Exception error){notice=error.Message;exitCode=1;}
            finally{mutex.ReleaseMutex();}
        }
        // Release the launch mutex BEFORE displaying any blocking notice.
        // An old error dialog must not make future shortcut clicks silently no-op.
        if(notice!=null&&!check&&!quiet) {
            if((exitCode==4 || status) && notice.Contains("恢复 Loader")) {
                if(MessageBox.Show(notice+"\n\n现在打开“恢复 Loader”？","Context Lens",MessageBoxButtons.YesNo,MessageBoxIcon.Information)==DialogResult.Yes) OpenRecovery();
            } else MessageBox.Show(notice,"Context Lens",MessageBoxButtons.OK,MessageBoxIcon.Information);
        }
        return exitCode;
    }
}
