using System.Text.Json;
using System.Text.Json.Serialization;

namespace BetterSteps.Capture;

/// <summary>NDJSON over stdout. See docs/ipc-contract.md.</summary>
internal static class Protocol
{
    private static readonly object Gate = new();

    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    internal static void Emit(object message)
    {
        var line = JsonSerializer.Serialize(message, Options);
        // One writer, many producer threads: the hook thread and the worker
        // both emit, and interleaved partial lines would corrupt the stream.
        lock (Gate)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    internal static void Log(string level, string message) =>
        Emit(new { v = 1, type = "log", id = Guid.NewGuid().ToString(), level, message });

    internal static void Error(string code, string message) =>
        Emit(new { v = 1, type = "error", id = Guid.NewGuid().ToString(), code, message });
}

internal sealed record Point2(int X, int Y);
internal sealed record MonitorInfo(int Index, double Scale);
internal sealed record RectInfo(int X, int Y, int W, int H);
internal sealed record WindowInfo(string Title, string Process, RectInfo Rect);
internal sealed record TargetInfo(string? Name, string? ControlType, string? AutomationId);

internal sealed record StepMessage
{
    public int V { get; init; } = 1;
    public string Type { get; init; } = "step";
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public int Seq { get; init; }
    public string Ts { get; init; } = DateTime.UtcNow.ToString("o");
    public string Action { get; init; } = "leftClick";
    /// <summary>Step id this one replaces (double-click folding). Usually null.</summary>
    public string? Supersedes { get; init; }
    /// <summary>Step id this re-recording replaces, from an armOnce command.</summary>
    public string? Replaces { get; init; }
    public Point2? Point { get; init; }
    public Point2? EndPoint { get; init; }
    public MonitorInfo? Monitor { get; init; }
    public WindowInfo? Window { get; init; }
    public TargetInfo? Target { get; init; }
    public string? Screenshot { get; init; }
    /// <summary>Redacted text for a keyText step. Never set for a password step.</summary>
    public string? Typed { get; init; }
    public string? Text { get; init; }
}
