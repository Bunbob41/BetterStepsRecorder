using System.Runtime.InteropServices;

namespace BetterSteps.Capture;

/// <summary>
/// Whether this recorder can see what happens in another program at all.
///
/// Windows withholds a higher-privilege program's input from a lower-privilege
/// program's hooks - User Interface Privilege Isolation - so a click in a program
/// started with Run as administrator never reaches a recorder that was not. There
/// is no error and no event: the step simply does not exist. Found by starting
/// HYPACK that way, which produced two recordings with no HYPACK steps in them
/// and nothing anywhere to say why.
///
/// The comparison is by integrity level, which is what the isolation is decided
/// by: a program at a higher level than this one cannot be watched. A program
/// whose token this one is not even allowed to open is higher by definition.
/// </summary>
internal static class Privilege
{
    private const int Medium = 0x2000;

    /// <summary>This process's own level. A recorder running as administrator is
    /// high, and then only SYSTEM programs are out of its sight.</summary>
    private static readonly int Own = IntegrityOf(Win32.GetCurrentProcess()).Level ?? Medium;

    /// <summary>Whether this recorder is shut out of a process's input.</summary>
    internal static bool CannotSee(uint pid)
    {
        if (pid == 0 || pid == (uint)Environment.ProcessId) return false;

        var process = Win32.OpenProcess(Win32.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (process == IntPtr.Zero)
        {
            // Denied even the least there is to ask: above this process. Any other
            // failure - most often a process that has already exited - says
            // nothing about privilege, and is not reported as a wall.
            return Marshal.GetLastWin32Error() == Win32.ERROR_ACCESS_DENIED;
        }

        try
        {
            var (level, denied) = IntegrityOf(process);
            return level is int known ? known > Own : denied;
        }
        finally
        {
            Win32.CloseHandle(process);
        }
    }

    private static (int? Level, bool Denied) IntegrityOf(IntPtr process)
    {
        if (!Win32.OpenProcessToken(process, Win32.TOKEN_QUERY, out var token))
        {
            return (null, Marshal.GetLastWin32Error() == Win32.ERROR_ACCESS_DENIED);
        }

        try
        {
            Win32.GetTokenInformation(token, Win32.TokenIntegrityLevel, IntPtr.Zero, 0, out var needed);
            if (needed <= 0) return (null, false);

            var buffer = Marshal.AllocHGlobal(needed);
            try
            {
                if (!Win32.GetTokenInformation(token, Win32.TokenIntegrityLevel, buffer, needed, out _))
                {
                    return (null, false);
                }

                // TOKEN_MANDATORY_LABEL begins with the SID pointer; the level is
                // the SID's last sub-authority.
                var sid = Marshal.ReadIntPtr(buffer);
                var count = Marshal.ReadByte(Win32.GetSidSubAuthorityCount(sid));
                if (count == 0) return (null, false);
                return (Marshal.ReadInt32(Win32.GetSidSubAuthority(sid, (uint)(count - 1))), false);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            Win32.CloseHandle(token);
        }
    }
}
