' Kuro Desktop Companion — Headless Background Service Launcher
' Launches node server.mjs in the background without creating a console window.

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

serverScript = scriptDir & "\server.mjs"
If FSO.FileExists(serverScript) Then
    WshShell.Run "node """ & serverScript & """", 0, False
Else
    Wscript.Echo "Error: Could not find server.mjs in " & scriptDir
End If

