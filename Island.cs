// Island.exe: the one way to run the island. Everything it starts runs hidden, with no PowerShell or cmd windows.
// Double-click it for a small window. Or give it a command:
//   Island.exe visit [--minutes N] [--no-push] [--wait-for-morning] [--with-visitor]
//                                   start a day; returns at once, the day runs on its own
//                                   (--with-visitor: the visitor comes back and is awake at the same time)
//   Island.exe visitor [minutes]    one visit from another mind, invited by the islander (runner\visitor.ps1); returns at once
//   Island.exe test [minutes] [--with-visitor]   a throwaway test day in .test\ (the real islander and visitor are
//                                   not touched); waits for it
//   Island.exe check                check that the scripts are well-formed
//   Island.exe status               day count, last runner.log lines, bottles waiting
//   Island.exe save "message"       commit everything and push to GitHub
//   Island.exe replay               open the replay viewer
//   Island.exe bottles              read and answer bottles (opens its own window, it asks you questions)
//   Island.exe notify "text"        show a Windows notification from The Island (visit.ps1 uses it at the end of a day)
//   Island.exe end                  end today's day now, as sunset would (the islander and any visitor sleep);
//                                   waits while the day is written down and saved
// Build (once): C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /r:System.Management.dll /out:Island.exe Island.cs
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Management;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

// Windows names the sender of a notification after these, so popups say "The Island".
[assembly: AssemblyTitle("The Island")]
[assembly: AssemblyProduct("The Island")]

static class Island
{
    static readonly string Root = Path.GetDirectoryName(Application.ExecutablePath);
    static readonly string PowerShell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Application.EnableVisualStyles();
            Application.Run(new MainWindow());
            return 0;
        }
        try
        {
            switch (args[0].ToLowerInvariant())
            {
                case "visit": return Visit(args.Skip(1).ToArray());
                case "visitor": return Visitor(args.Length > 1 ? int.Parse(args[1]) : 10);
                case "test": return Test(args.Skip(1).ToArray());
                case "check": return Check();
                case "status": Out(Status()); return 0;
                case "save": return Save(args.Length > 1 ? args[1] : "Update");
                case "replay": OpenReplay(); return 0;
                case "bottles": OpenBottles(); return 0;
                case "notify": Notify(args.Length > 1 ? args[1] : "The island."); return 0;
                case "end": return End();
                default: Out("Unknown command: " + args[0] + ". Use visit, visitor, test, check, status, save, replay, bottles or end."); return 2;
            }
        }
        catch (Exception e)
        {
            Out("ERROR: " + e.Message);
            return 1;
        }
    }

    // Output goes to whoever started us (if they listen) and to logs\island-exe.log.
    static void Out(string text)
    {
        try { Console.Out.WriteLine(text); Console.Out.Flush(); } catch { }
        try
        {
            Directory.CreateDirectory(Path.Combine(Root, "logs"));
            File.AppendAllText(Path.Combine(Root, @"logs\island-exe.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + text + Environment.NewLine, Utf8);
        }
        catch { }
    }

    static string Quote(string s) { return "\"" + s.Replace("\"", "\\\"") + "\""; }

    // Run a program hidden and wait for it, collecting what it prints.
    static int Run(string file, string arguments, string cwd, StringBuilder output)
    {
        var psi = new ProcessStartInfo(file, arguments)
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = cwd,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        using (var p = new Process { StartInfo = psi })
        {
            DataReceivedEventHandler add = (s, e) => { if (e.Data != null) lock (output) output.AppendLine(e.Data); };
            p.OutputDataReceived += add;
            p.ErrorDataReceived += add;
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    static string PsFile(string script, string extra)
    {
        return "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script) + (extra.Length > 0 ? " " + extra : "");
    }

    // --- visit ------------------------------------------------------------------
    static int Visit(string[] opts)
    {
        var extra = new StringBuilder();
        for (int i = 0; i < opts.Length; i++)
        {
            switch (opts[i].ToLowerInvariant())
            {
                case "--minutes": extra.Append(" -Minutes " + int.Parse(opts[++i])); break;
                case "--no-push": extra.Append(" -NoPush"); break;
                case "--wait-for-morning": extra.Append(" -WaitForMorning"); break;
                case "--with-visitor": extra.Append(" -WithVisitor"); break;
                default: throw new ArgumentException("Unknown visit option " + opts[i]);
            }
        }
        var psi = new ProcessStartInfo(PowerShell, PsFile(Path.Combine(Root, @"runner\visit.ps1"), extra.ToString().Trim()))
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Root,
        };
        var p = Process.Start(psi);
        Out("Visit started (process " + p.Id + "). It runs on its own; see logs\\runner.log.");
        return 0;
    }

    // --- visitor ----------------------------------------------------------------
    static int Visitor(int minutes)
    {
        var psi = new ProcessStartInfo(PowerShell, PsFile(Path.Combine(Root, @"runner\visitor.ps1"), "-Minutes " + minutes))
        {
            UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Root,
        };
        var p = Process.Start(psi);
        Out("Visitor started (process " + p.Id + ", up to " + minutes + " minutes). It runs on its own; see logs\\runner.log.");
        return 0;
    }

    // --- test: a throwaway islander in .test\ ------------------------------------
    static void DeleteTree(string dir)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) File.SetAttributes(f, FileAttributes.Normal);
        Directory.Delete(dir, true);
    }

    static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        foreach (var d in Directory.GetDirectories(from)) CopyTree(d, Path.Combine(to, Path.GetFileName(d)));
    }

    static int Test(string[] opts)
    {
        int minutes = 4;
        bool withVisitor = false;
        foreach (var o in opts)
        {
            if (o.ToLowerInvariant() == "--with-visitor") withVisitor = true;
            else minutes = int.Parse(o);
        }
        var test = Path.Combine(Root, ".test");
        DeleteTree(test);
        CopyTree(Path.Combine(Root, "runner"), Path.Combine(test, "runner"));
        CopyTree(Path.Combine(Root, "viewer"), Path.Combine(test, "viewer"));
        Directory.CreateDirectory(Path.Combine(test, "island"));
        var log = new StringBuilder();
        Run("git", "init -q", test, log);
        Run("git", "config user.name test", test, log);
        Run("git", "config user.email test@example.invalid", test, log);
        Out("Test day of " + minutes + " minutes in .test\\ (a fresh islander" + (withVisitor ? " and a fresh visitor" : "") + "; the real ones are not touched)...");
        int code = Run(PowerShell, PsFile(Path.Combine(test, @"runner\visit.ps1"), "-Minutes " + minutes + " -NoPush -Quiet" + (withVisitor ? " -WithVisitor" : "")), test, log);
        Out(string.Join(Environment.NewLine, log.ToString().Split('\n').Where(l => !l.Contains("LF will be replaced")).Select(l => l.TrimEnd('\r'))).Trim());
        var diary = Path.Combine(test, @"logs\day-001.md");
        if (File.Exists(diary)) Out("--- diary ---" + Environment.NewLine + File.ReadAllText(diary, Utf8));
        var visitorDiary = Path.Combine(test, @"logs\visitor-001.md");
        if (File.Exists(visitorDiary)) Out("--- visitor's diary ---" + Environment.NewLine + File.ReadAllText(visitorDiary, Utf8));
        Out("Test finished (exit code " + code + "). Replay: .test\\viewer\\index.html");
        return code;
    }

    // --- check ------------------------------------------------------------------
    static int Check()
    {
        int bad = 0;
        var scripts = Directory.GetFiles(Path.Combine(Root, "runner"), "*.ps1").Concat(new[] { Path.Combine(Root, "bottles.ps1") });
        foreach (var s in scripts)
        {
            var o = new StringBuilder();
            var cmd = "$e=$null;$t=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile('" + s.Replace("'", "''") + "',[ref]$t,[ref]$e);$e.Count";
            Run(PowerShell, "-NoProfile -Command " + Quote(cmd), Root, o);
            var n = o.ToString().Trim();
            if (n != "0") bad++;
            Out((n == "0" ? "ok    " : "FAIL  ") + s.Substring(Root.Length + 1) + (n == "0" ? "" : "  " + n));
        }
        foreach (var s in new[] { @"runner\world.mjs", @"viewer\art.js" })
        {
            var o = new StringBuilder();
            int c = Run("node", "--check " + Quote(Path.Combine(Root, s)), Root, o);
            if (c != 0) bad++;
            Out((c == 0 ? "ok    " : "FAIL  ") + s + (c == 0 ? "" : "  " + o.ToString().Trim()));
        }
        Out(bad == 0 ? "All good." : bad + " problem(s).");
        return bad == 0 ? 0 : 1;
    }

    // --- status -----------------------------------------------------------------
    static int WaitingBottles()
    {
        var dir = Path.Combine(Root, @"island\bottles");
        if (!Directory.Exists(dir)) return 0;
        return Directory.GetFiles(dir, "*.md").Count(f => !f.EndsWith(".reply.md") && !File.Exists(f.Substring(0, f.Length - 3) + ".reply.md"));
    }

    static string Status()
    {
        var sb = new StringBuilder();
        var state = Path.Combine(Root, "state.json");
        sb.AppendLine(File.Exists(state) ? File.ReadAllText(state, Utf8).Trim() : "No days yet.");
        sb.AppendLine("Bottles waiting for an answer: " + WaitingBottles());
        var log = Path.Combine(Root, @"logs\runner.log");
        if (File.Exists(log))
        {
            sb.AppendLine("--- runner.log ---");
            foreach (var l in File.ReadAllLines(log, Utf8).Reverse().Take(8).Reverse()) sb.AppendLine(l);
        }
        return sb.ToString().TrimEnd();
    }

    // --- save -------------------------------------------------------------------
    static int Save(string message)
    {
        var o = new StringBuilder();
        var msgFile = Path.GetTempFileName();
        File.WriteAllText(msgFile, message.Replace("\\n", "\n"), Utf8);
        Run("git", "add -A", Root, o);
        int c = Run("git", "commit -q -F " + Quote(msgFile), Root, o);
        File.Delete(msgFile);
        if (c == 0) c = Run("git", "push -q", Root, o);
        Out(string.Join(Environment.NewLine, o.ToString().Split('\n').Where(l => !l.Contains("LF will be replaced")).Select(l => l.TrimEnd('\r'))).Trim());
        Out(c == 0 ? "Saved and pushed." : "git exit code " + c);
        return c;
    }

    // --- end: the owner ends today's day now ----------------------------------------
    // The minds (claude.exe) are stopped the way sunset stops them; visit.ps1 and visitor.ps1 keep running
    // and write the diaries, the replay and the commit as usual.
    static List<Tuple<int, string>> Children(int pid)
    {
        var list = new List<Tuple<int, string>>();
        using (var s = new ManagementObjectSearcher("SELECT ProcessId, Name FROM Win32_Process WHERE ParentProcessId = " + pid))
            foreach (ManagementObject m in s.Get()) list.Add(Tuple.Create(Convert.ToInt32(m["ProcessId"]), ((string)m["Name"]).ToLowerInvariant()));
        return list;
    }

    static int End()
    {
        var lockPath = Path.Combine(Root, ".visit.lock");
        if (!File.Exists(lockPath)) { Out("No day is running."); return 0; }
        Process visit;
        try { visit = Process.GetProcessById(int.Parse(File.ReadAllText(lockPath).Trim())); }
        catch { Out("No day is running (stale .visit.lock)."); return 0; }
        if (visit.ProcessName.ToLowerInvariant() != "powershell") { Out("No day is running (.visit.lock points at " + visit.ProcessName + ")."); return 0; }
        var children = Children(visit.Id);
        var minds = children.Where(c => c.Item2 == "claude.exe").ToList();
        foreach (var ps in children.Where(c => c.Item2 == "powershell.exe")) minds.AddRange(Children(ps.Item1).Where(c => c.Item2 == "claude.exe"));
        if (minds.Count == 0) { Out("Nobody is awake; the day is already being written down."); }
        foreach (var m in minds)
        {
            var o = new StringBuilder();
            Run("taskkill.exe", "/T /F /PID " + m.Item1, Root, o);
            Out("Stopped claude.exe " + m.Item1 + ".");
        }
        Out("Waiting for the day to be written down and saved...");
        if (!visit.WaitForExit(300000)) { Out("Still saving after 5 minutes; see logs\\runner.log."); return 1; }
        Out(Status());
        return 0;
    }

    // --- notify -------------------------------------------------------------------
    static void Notify(string text)
    {
        using (var icon = new NotifyIcon { Icon = SystemIcons.Information, Text = "The Island", Visible = true })
        {
            icon.BalloonTipClicked += (s, e) => OpenReplay();
            icon.ShowBalloonTip(15000, "The Island", text, ToolTipIcon.Info);
            // Keep the message loop running so a click on the popup opens the replay.
            var timer = new Timer { Interval = 20000 };
            timer.Tick += (s, e) => Application.ExitThread();
            timer.Start();
            Application.Run();
            icon.Visible = false;
        }
    }

    // --- things to open ---------------------------------------------------------
    public static void OpenReplay() { Process.Start(new ProcessStartInfo(Path.Combine(Root, @"viewer\index.html")) { UseShellExecute = true }); }

    public static void OpenBottles()
    {
        Process.Start(new ProcessStartInfo(PowerShell, PsFile(Path.Combine(Root, "bottles.ps1"), "")) { UseShellExecute = true, WorkingDirectory = Root });
    }

    // --- the window you get by double-clicking ------------------------------------
    class MainWindow : Form
    {
        readonly Label info = new Label { AutoSize = false, Dock = DockStyle.Top, Height = 64, Padding = new Padding(4) };
        readonly Button bottles = new Button { Width = 300, Height = 36 };

        public MainWindow()
        {
            Text = "The Island";
            ClientSize = new Size(340, 230);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10f);
            var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(16, 4, 16, 8) };
            var watch = new Button { Text = "Watch the replay", Width = 300, Height = 36 };
            watch.Click += (s, e) => OpenReplay();
            bottles.Click += (s, e) => OpenBottles();
            var folder = new Button { Text = "Open the island folder", Width = 300, Height = 36 };
            folder.Click += (s, e) => Process.Start(new ProcessStartInfo(Root) { UseShellExecute = true });
            flow.Controls.AddRange(new Control[] { watch, bottles, folder });
            var top = new Panel { Dock = DockStyle.Top, Height = 72, Padding = new Padding(16, 12, 16, 0) };
            top.Controls.Add(info);
            Controls.Add(flow);
            Controls.Add(top);
            Activated += (s, e) => Refresh2();
            Refresh2();
        }

        void Refresh2()
        {
            int day = 0;
            string last = "never";
            var state = Path.Combine(Root, "state.json");
            if (File.Exists(state))
            {
                var t = File.ReadAllText(state, Utf8);
                var m = System.Text.RegularExpressions.Regex.Match(t, "\"day\"\\s*:\\s*(\\d+)");
                if (m.Success) day = int.Parse(m.Groups[1].Value);
                m = System.Text.RegularExpressions.Regex.Match(t, "\"lastVisitEnd\"\\s*:\\s*\"([^\"]+)\"");
                DateTime when;
                if (m.Success && DateTime.TryParse(m.Groups[1].Value, out when)) last = when.ToString("ddd d MMM, HH:mm");
            }
            info.Text = "Days lived: " + day + "\nLast day ended: " + last + "\nNext visit: every morning 9:00 to 10:00";
            int n = WaitingBottles();
            bottles.Text = n == 0 ? "Bottles (none waiting)" : "Read bottles (" + n + " waiting)";
        }
    }
}
