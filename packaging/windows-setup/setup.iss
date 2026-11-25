#define Root GetEnv("LENS_BUILD_ROOT")
#define Version GetEnv("LENS_BUILD_VERSION")
#define NodeRel GetEnv("LENS_BUILD_NODE")
#define Fixture GetEnv("LENS_BUILD_FIXTURE")

[Setup]
AppId=ContextLens.Desktop{#Fixture}
AppName=Codex Context Manager
AppVersion={#Version}
VersionInfoVersion={#Version}.0
PrivilegesRequired=lowest
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
DefaultDirName={localappdata}\Programs\ContextLens
DefaultGroupName=Context Lens
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
UsePreviousAppDir=no
UsePreviousGroup=no
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\dist\launcher\Context-Lens.exe
#if GetEnv("LENS_MEASURE_DICTIONARY") == "large"
Compression=lzma2/ultra64
LZMADictionarySize=131072
LZMANumBlockThreads=1
#else
Compression=lzma2/max
#endif
SolidCompression=yes
MergeDuplicateFiles=yes
OutputDir={#GetEnv("LENS_SETUP_OUTPUT_DIR")}
OutputBaseFilename={#GetEnv("LENS_SETUP_NAME")}{#Fixture}
#if Fixture != ""
CreateUninstallRegKey=no
#endif

[Languages]
Name: "zh"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Files]
#include GetEnv("LENS_BUILD_FILES")

[Dirs]
Name: "{app}\.research"

[Icons]
Name: "{code:ProgramDir}\Codex + Context Lens"; Filename: "{app}\dist\launcher\Context-Lens.exe"; WorkingDir: "{app}"; Check: NewProgramShortcut('Codex + Context Lens')
Name: "{code:ProgramDir}\Codex + Context Lens（实验扩容）"; Filename: "{app}\dist\launcher\Context-Lens-Experimental.exe"; WorkingDir: "{app}"; Check: WantExperiment and NewProgramShortcut('Codex + Context Lens（实验扩容）'); Flags: createonlyiffileexists
Name: "{code:ProgramDir}\查看状态"; Filename: "{app}\dist\launcher\Context-Lens-Status.exe"; WorkingDir: "{app}"; Check: NewProgramShortcut('查看状态')
Name: "{code:ProgramDir}\恢复 Loader"; Filename: "{app}\dist\launcher\Context-Lens-Recovery.exe"; WorkingDir: "{app}"; Check: NewProgramShortcut('恢复 Loader')
Name: "{code:DesktopDir}\Codex + Context Lens"; Filename: "{app}\dist\launcher\Context-Lens.exe"; WorkingDir: "{app}"; Check: NewMonitorShortcut
Name: "{code:DesktopDir}\Codex + Context Lens（实验扩容）"; Filename: "{app}\dist\launcher\Context-Lens-Experimental.exe"; WorkingDir: "{app}"; Check: NewExperimentalShortcut

[UninstallRun]
Filename: "{app}\{#NodeRel}"; Parameters: """{app}\packaging\windows-setup\sidebar-files.mjs"" uninstall ""{code:LocalData}"""; Flags: runhidden waituntilterminated

[UninstallDelete]
Type: files; Name: "{app}\installer-sidebar-owner.json"
Type: files; Name: "{app}\{#GetEnv("LENS_BUILD_BACKEND")}\codex-code-mode-host.exe"

[Code]
var
  ModePage: TInputOptionWizardPage;
  DesktopKind, LoaderKind: Integer;
  HadExperiment: Boolean;

#if GetEnv("LENS_SETUP_MEASURE") == "1"
function InitializeSetup: Boolean;
begin
  Result := False;
end;
#endif

function LocalData(Param: String): String;
begin
#if Fixture == ""
  Result := ExpandConstant('{localappdata}');
#else
  Result := '{#GetEnv("LENS_FIXTURE_PROFILE")}';
#endif
end;

function RunPS(Script: String): Integer;
var R: Integer;
begin
  Result := -1;
  if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
     '-NoProfile -NonInteractive -Command "' + Script + '"','',SW_HIDE,ewWaitUntilTerminated,R) then Result := R;
end;

function ProgramDir(Param: String): String;
begin
#if Fixture == ""
  Result := ExpandConstant('{userprograms}\Context Lens');
#else
  Result := LocalData('')+'\programs\Context Lens';
#endif
end;

function DesktopDir(Param: String): String;
begin
#if Fixture == ""
  Result := ExpandConstant('{userdesktop}');
#else
  Result := LocalData('')+'\desktop';
#endif
end;

function NewProgramShortcut(Name: String): Boolean;
begin
  Result := not FileExists(ProgramDir('')+'\'+Name+'.lnk');
end;

function QuotedPS(Value: String): String;
begin
  StringChangeEx(Value, '''', '''''', True);
  Result := '''' + Value + '''';
end;

function DetectDesktop: Integer;
begin
#if Fixture != ""
  { The isolated installer exercises both a supported and a newly updated desktop. }
  if FileExists(LocalData('')+'\simulated-new-desktop') then Result := 12 else Result := 10;
#else
  Result := RunPS('$p=Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Select-Object -First 1; ' +
    'if($p.PackageFamilyName -ne ''OpenAI.Codex_2p2nqsd0c76g0''){exit 1}; ' +
    'if(@({#GetEnv("LENS_BUILD_DESKTOP_SET")}) -contains [string]$p.Version){exit 10}; exit 12');
#endif
end;

function DetectLoader: Integer;
var D: String;
begin
  D := '';
#if Fixture == ""
  RegQueryStringValue(HKCU64,'Software\CodexScriptLoader','InstallDir',D);
#endif
  if D='' then D := LocalData('')+'\Programs\CodexScriptLoader';
  if not DirExists(D) then begin Result := 0; exit; end;
  Result := -1;
  if not FileExists(D+'\CodexScriptLoader.exe') then exit;
  Result := RunPS('$ErrorActionPreference=''Stop''; $d='+QuotedPS(D)+'; '+
    '$a=Get-Content -Raw -LiteralPath (Join-Path $d ''active.json'')|ConvertFrom-Json; '+
    'if($a.schemaVersion -ne 1 -or $a.handoffProtocol -ne 1 -or $a.launcherProtocol -ne 1 -or $a.rid -ne ''win-x64'' -or $a.entryPoint -ne ''CodexScriptLoader.exe'' -or $a.version -notmatch ''^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$''){exit 1}; '+
    '$v=Join-Path $d (''versions/''+$a.version+''/win-x64''); if(!(Test-Path -LiteralPath (Join-Path $v ''CodexScriptLoader.Command.exe'')) -or !(Test-Path -LiteralPath (Join-Path $v ''CodexScriptLoader.exe''))){exit 1}; '+
    'if($a.version -eq ''0.6.2''){exit 10}; exit 12');
end;

function WantExperiment: Boolean;
begin
  Result := ModePage.SelectedValueIndex=1;
end;

function InstallExperimentalComponents: Boolean;
begin
  Result := WantExperiment or HadExperiment;
end;

function InstallPrivateLoader: Boolean;
begin
  Result := (LoaderKind=0) or FileExists(AddBackslash(WizardDirValue)+'dist\private-loader\active.json');
end;

function NewMonitorShortcut: Boolean;
begin
  Result := not FileExists(DesktopDir('')+'\Codex + Context Lens.lnk');
end;

function NewExperimentalShortcut: Boolean;
begin
  Result := WantExperiment and not FileExists(DesktopDir('')+'\Codex + Context Lens（实验扩容）.lnk');
end;

procedure InitializeWizard;
var Possible: Boolean; Detail: String;
begin
  DesktopKind := DetectDesktop;
  LoaderKind := DetectLoader;
  Possible := (DesktopKind=10) and ((LoaderKind=0) or (LoaderKind=10));
#if GetEnv("LENS_SETUP_PORTABLE") == "1"
  if LoaderKind=0 then Detail := '将使用安装包内的私有 Loader；卸载 Context Lens 时一并移除。'
#else
  if LoaderKind=0 then Detail := '安装时将为当前用户安装 Codex Script Loader 0.6.2。'
#endif
  else Detail := '安装器会复用现有的 Codex Script Loader。';
  if DesktopKind=1 then Detail := '请先安装 Windows 版 Codex，完成后再运行此安装器。'
  else if not Possible then Detail := Detail+' 当前组合尚未通过实验扩容验收。';
  ModePage := CreateInputOptionPage(wpWelcome,'安装 Context Lens','选择此电脑需要的功能',
    Detail+' Loader 通过本机调试连接在 Codex 窗口加载左栏脚本。',True,False);
  if FileExists(AddBackslash(WizardDirValue)+'dist\launcher\Context-Lens-Experimental.exe') then
    ModePage.Add('更新监控 · 同步更新已安装的实验组件')
  else ModePage.Add('仅监控 · 显示当前对话容量和剩余比例');
  ModePage.Add('监控和实验扩容 · 使用经过验证的单对话后台');
  ModePage.CheckListBox.ItemEnabled[1] := Possible;
  ModePage.SelectedValueIndex := 0;
  if Possible and ((ExpandConstant('{param:MODE|}')='experimental') or
    ((ExpandConstant('{param:MODE|}')='') and FileExists(AddBackslash(WizardDirValue)+'dist\launcher\Context-Lens-Experimental.exe')))
  then ModePage.SelectedValueIndex := 1;
end;

function InstalledProgramsIdle(D: String): Boolean;
begin
  Result := RunPS('$ErrorActionPreference=''Stop''; $d='+QuotedPS(AddBackslash(D))+'; '+
    '$p=Get-CimInstance Win32_Process -Property Name,ExecutablePath | Where-Object { $_.ExecutablePath -and '+
    '($_.Name -in ''node.exe'',''codex.exe'',''codex-code-mode-host.exe'',''CodexScriptLoader.exe'' -or $_.Name -like ''Context-Lens*.exe'') -and '+
    '$_.ExecutablePath.StartsWith($d,[StringComparison]::OrdinalIgnoreCase) }; if($p){exit 1}; exit 0')=0;
end;

function Occupied(D: String): Boolean;
var Entry: TFindRec;
begin
  Result := False;
  if FindFirst(AddBackslash(D)+'*',Entry) then try
    repeat
      if (Entry.Name<>'.') and (Entry.Name<>'..') then begin Result := True; break; end;
    until not FindNext(Entry);
  finally FindClose(Entry); end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var R,Fresh: Integer; F,D: String; Marker: AnsiString;
begin
  Result := '';
  D := ExpandConstant('{app}');
  HadExperiment := FileExists(D+'\dist\launcher\Context-Lens-Experimental.exe');
  if DirExists(D) and Occupied(D) then begin
    if not LoadStringFromFile(D+'\context-lens-install.id',Marker) or (Marker<>'Context Lens Desktop') then begin
      Result := '目标目录中已有其他文件，请将原目录移开后再安装。'; exit;
    end;
    if not InstalledProgramsIdle(D) then begin Result := '请保存工作并退出由此安装目录启动的 Context Lens 和 Codex，然后再次安装。'; exit; end;
  end;
  Fresh := DetectDesktop;
  if (DesktopKind<>Fresh) or ((Fresh<>10) and (Fresh<>12)) then begin
    Result := '请先安装 Windows 版 Codex，并在系统更新结束后重新运行安装器。'; exit;
  end;
  LoaderKind := DetectLoader;
  if (LoaderKind<>0) and (LoaderKind<>10) and (LoaderKind<>12) then begin
    Result := '现有 Loader 安装不完整或协议不兼容，请先通过 Loader 安装器修复。'; exit;
  end;
  if (WantExperiment or (ExpandConstant('{param:MODE|}')='experimental')) and
    ((Fresh=12) or (LoaderKind=12)) then begin Result := '当前桌面或 Loader 版本尚未验证扩容。'; exit; end;
#if GetEnv("LENS_SETUP_PORTABLE") != "1"
  if LoaderKind=0 then begin
    ExtractTemporaryFile('LoaderSetup.exe');
    F := ExpandConstant('{tmp}\LoaderSetup.exe');
    if CompareText(GetSHA256OfFile(F),'{#GetEnv("LENS_LOADER_SETUP_HASH")}')<>0 then begin Result := 'Loader 安装包校验失败。'; exit; end;
    if not Exec(F,'/S','',SW_HIDE,ewWaitUntilTerminated,R) or (R<>0) or (DetectLoader<>10) then
      Result := 'Loader 未完成安装，请检查上游安装记录后重试。';
  end;
#endif
end;

function InitializeUninstall: Boolean;
begin
  Result := InstalledProgramsIdle(ExpandConstant('{app}'));
  if not Result then SuppressibleMsgBox('请先退出由此安装目录启动的 Context Lens 和 Codex，再卸载。',mbInformation,MB_OK,IDOK);
end;

procedure CurUninstallStepChanged(Step: TUninstallStep);
var D: String;
begin
  if Step=usPostUninstall then begin
    D := ExpandConstant('{app}');
    if not Occupied(D+'\.research') then begin
      DeleteFile(D+'\context-lens-install.id');
      RemoveDir(D);
    end;
  end;
end;

procedure RegisterSidebar;
var R: Integer;
begin
  if not Exec(ExpandConstant('{app}\{#NodeRel}'),
    '"'+ExpandConstant('{app}\packaging\windows-setup\sidebar-files.mjs')+'" install "'+LocalData('')+'"',
    ExpandConstant('{app}'),SW_HIDE,ewWaitUntilTerminated,R) or (R<>0) then
    RaiseException('左栏登记失败，请确认现有插件版本及目录可写权限。');
end;
