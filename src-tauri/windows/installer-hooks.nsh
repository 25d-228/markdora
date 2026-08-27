!define MARKDORA_SHCNE_UPDATEITEM 0x00002000
!define MARKDORA_SHCNF_PATHW_FLUSH 0x1005

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "$INSTDIR\markdora-light.ico" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    System::Call 'shell32::SHChangeNotify(i ${MARKDORA_SHCNE_UPDATEITEM}, i ${MARKDORA_SHCNF_PATHW_FLUSH}, w "$DESKTOP\${PRODUCTNAME}.lnk", i 0)'
  ${EndIf}
!macroend
