; Claude Forge - bare-Windows bootstrapper.
; Runs on a freshly-reset machine (no cmd/powershell/git/node needed).
; Uses curl.exe + tar.exe shipped in Windows System32 to fetch Node + Git,
; then hands off to bootstrap/install.sh for the rest.
Unicode true
ManifestSupportedOS all
Name "Claude Forge - Environment Setup"
OutFile "setup.exe"
RequestExecutionLevel user
ShowInstDetails show
XPStyle on
Caption "Claude Forge - Environment Setup"

Page instfiles

!define NODEZIP "https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip"
!define GITEXE  "https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.1/PortableGit-2.51.0-64-bit.7z.exe"
!define TOOLS   "C:\Users\CKIRUser\tools"
!define NODEDIR "C:\Users\CKIRUser\tools\node"
!define GITDIR  "C:\Users\CKIRUser\PortableGit"

Section "Bootstrap"
  DetailPrint "=== Claude Forge environment setup ==="
  DetailPrint "Fetching tools with curl/tar from Windows System32 (no admin needed)."

  ; ---- Node.js ----
  IfFileExists "${NODEDIR}\node.exe" node_ready
    DetailPrint "Downloading Node.js 24.16.0 ..."
    ExecWait 'curl.exe -L --fail -o "$TEMP\cf-node.zip" "${NODEZIP}"' $0
    DetailPrint "curl(node) exit: $0"
    CreateDirectory "${TOOLS}"
    DetailPrint "Extracting Node.js ..."
    ExecWait 'tar.exe -xf "$TEMP\cf-node.zip" -C "${TOOLS}"' $0
    Rename "${TOOLS}\node-v24.16.0-win-x64" "${NODEDIR}"
  IfFileExists "${NODEDIR}\node.exe" node_ready
    DetailPrint "!! Node.js setup failed (check internet) - aborting."
    Goto done
  node_ready:
  DetailPrint "Node.js ready."

  ; ---- Git for Windows (PortableGit -> provides bash.exe) ----
  IfFileExists "${GITDIR}\bin\bash.exe" git_ready
    DetailPrint "Downloading Git for Windows (PortableGit) ..."
    ExecWait 'curl.exe -L --fail -o "$TEMP\cf-git.exe" "${GITEXE}"' $0
    DetailPrint "curl(git) exit: $0"
    DetailPrint "Extracting Git (this can take a minute) ..."
    ExecWait '"$TEMP\cf-git.exe" -o"${GITDIR}" -y' $0
  IfFileExists "${GITDIR}\bin\bash.exe" git_ready
    DetailPrint "!! Git setup failed - aborting."
    Goto done
  git_ready:
  DetailPrint "Git Bash ready."

  ; ---- run the engine (pwsh 7 + Claude Code + project deps + patches) ----
  IfFileExists "$EXEDIR\install.sh" run_engine
    DetailPrint "!! install.sh not found next to setup.exe."
    Goto done
  run_engine:
  DetailPrint "Running install.sh ..."
  ExecWait '"${GITDIR}\bin\bash.exe" "$EXEDIR\install.sh"' $0
  DetailPrint "install.sh exit: $0"

  done:
  DetailPrint "=== Finished. ==="
  DetailPrint "Next: open Git Bash, run 'claude' to log in,"
  DetailPrint "then  cd claude-forge  &&  npm run dev"
SectionEnd
