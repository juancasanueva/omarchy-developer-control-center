import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The Developer Control Center panel.
//
// One keyboard-first surface over everything the background service found:
// projects, containers, services, machines, tools and the consolidated
// Attention list. The panel owns no discovery of its own — it renders rows
// produced by Model.js and turns key presses into the next state, so what
// the panel does is decided by testable functions rather than by bindings.
Panel {
  id: root
  moduleName: "io.github.juancasanueva.developer-control-center"
  ipcTarget: ""
  manageIpc: false

  // Injected by BarWidget.qml.
  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(root.moduleName) : null
  readonly property var snapshot: service ? service.snapshot : ({ repos: [], docker: { available: false, reason: "", containers: [] }, services: null, machines: [], tools: [], loaded: {} })
  readonly property var config: service ? service.config : Model.normalizeConfig({}, "")
  readonly property var env: service ? service.env : ({ home: "", defaultEditor: "", tools: [] })

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // The whole interface is one reducer state plus the rows derived from it.
  property var ui: Model.initialUi()
  readonly property var rows: Model.rowsFor(ui, snapshot, config, env)
  readonly property bool cursorActive: ui.index >= 0 && rows.length > ui.index && (rows[ui.index].type === "item" || rows[ui.index].type === "action")
  readonly property string title: ui.detail ? "" : ui.searching ? "Search" : ui.view.charAt(0).toUpperCase() + ui.view.slice(1)

  readonly property var confirmAction: ui.confirm ? ui.confirm.action : null
  readonly property string confirmMessage: confirmAction ? confirmAction.label + "?" : ""

  property string toast: ""

  function setUi(next) {
    if (!next) return
    root.ui = next
    Qt.callLater(root.snapCursor)
  }

  // Rows are rebuilt whenever the view, the query or the discovered state
  // changes, and index 0 is usually a section header. Snapping forward keeps
  // a real row under the cursor so Enter always has a target.
  function snapCursor() {
    var snapped = Model.moveSelection(root.ui, root.rows, 0)
    if (snapped.index !== root.ui.index) root.ui = snapped
    ensureVisible()
  }

  function moveCursor(delta) {
    setUi(Model.moveSelection(root.ui, root.rows, delta))
  }

  // Hover and click move the same cursor the keyboard moves, so the panel
  // never shows two highlights at once.
  function selectIndex(index) {
    if (root.ui.index === index) return
    var next = Model.moveSelection(root.ui, root.rows, 0)
    next.index = index
    root.ui = next
  }

  function activate() {
    var result = Model.activate(root.ui, root.rows, root.snapshot, root.config, root.env)
    setUi(result.ui)
    applyEffect(result.effect)
  }

  function back() {
    var result = Model.back(root.ui)
    setUi(result.ui)
    applyEffect(result.effect)
  }

  function jump(key) {
    setUi(Model.jumpSection(root.ui, key))
  }

  function search(text) {
    setUi(Model.typeSearch(root.ui, text))
  }

  function clearSearch() {
    searchField.text = ""
    setUi(Model.clearSearch(root.ui))
    returnFocusToList()
  }

  function refresh(what) {
    if (service) service.refresh(what || "")
    showToast(what ? "Refreshing " + what + "…" : "Refreshing…")
  }

  // Effects are the only place this panel touches the outside world. Commands
  // arrive as argv arrays built by Model.js — nothing is spliced into a shell
  // string here — and they are detached so a plugin reload cannot kill them.
  function applyEffect(effect) {
    if (!effect) return
    if (effect.type === "close") { root.close(); return }
    if (effect.type === "copy") {
      Quickshell.execDetached(["bash", "-c", "printf %s \"$1\" | wl-copy", "sh", String(effect.text)])
      showToast("Copied")
      return
    }
    if (effect.type === "refresh") { refresh(effect.what); return }
    if (effect.type !== "run" || !effect.command || effect.command.length === 0) return
    var command = effect.command
    if (effect.cwd) {
      command = ["bash", "-c", "cd \"$1\" || exit 1; shift 1; exec \"$@\"", "sh", effect.cwd].concat(command)
    }
    Quickshell.execDetached(command)
    if (effect.refresh) refreshTimer.what = effect.refresh
    if (effect.refresh) refreshTimer.restart()
    else root.close()
  }

  function showToast(message) {
    root.toast = message
    toastTimer.restart()
  }

  function focusSearchField() {
    searchField.forceActiveFocus()
    searchField.selectAll()
  }

  function returnFocusToList() {
    Qt.callLater(function () { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  function ensureVisible() {
    var item = rowRepeater.itemAt(root.ui.index)
    if (!item || !panelFlick) return
    if (item.y < panelFlick.contentY) panelFlick.contentY = Math.max(0, item.y - Style.space(4))
    else if (item.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = item.y + item.height - panelFlick.height + Style.space(4)
  }

  onOpenedChanged: {
    if (service) service.panelOpen = opened
    if (!opened) return
    searchField.text = ""
    setUi(Model.initialUi())
    if (panelFlick) panelFlick.contentY = 0
    if (service) service.refreshAll()
    Qt.callLater(root.snapCursor)
    Qt.callLater(function () { if (keyCatcher) keyCatcher.forceActiveFocus() })
  }

  Timer {
    id: toastTimer
    interval: 1600
    onTriggered: root.toast = ""
  }

  // A container that was just told to stop takes a moment to report it, so
  // the refresh is delayed rather than racing the daemon.
  Timer {
    id: refreshTimer
    property string what: ""
    interval: 900
    onTriggered: if (root.service) root.service.refresh(what)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(460))
    contentHeight: panel.fittedContentHeight(Style.space(560), Style.space(620))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: searchField.activeFocus || root.ui.confirm !== null

      onMoveRequested: function (dx, dy) { if (dy !== 0) root.moveCursor(dy) }
      onActivateRequested: root.activate()
      onCloseRequested: root.back()
      onTabRequested: function (direction) { root.switchPanel(direction) }
      // Single letters are section shortcuts, `/` starts a search. Letting a
      // bare letter fall through into the search box instead would make the
      // same keystroke mean two things: `p` would jump to Projects while `u`
      // began a query, and `l` would be swallowed as a movement key — so
      // "plug" arrived as "ug". One key, one meaning.
      onTextKey: function (t) {
        if (t === "/") { root.focusSearchField(); return }
        if (t === "r" || t === "R") { root.refresh(""); return }
        if (Model.sectionForKey(t) !== "") root.jump(t)
      }

      Column {
        id: header
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(8)

        PanelHero {
          width: parent.width
          title: "Dev Center"
          meta: root.service ? Model.heroMeta(root.snapshot) : "starting…"
          detail: root.toast
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              text: "󰆍"
              color: root.service && root.service.barState.severity !== "healthy" ? Color.urgent : root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
              textFormat: Text.PlainText
            }
          }
        }

        TextField {
          id: searchField
          width: parent.width
          placeholderText: "󰍉  Search projects, containers, ports, machines, actions…"
          foreground: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          onTextChanged: if (activeFocus) root.search(text)
          onAccepted: root.returnFocusToList()
          Keys.onPressed: function (event) {
            if (event.key === Qt.Key_Down) { root.returnFocusToList(); root.moveCursor(1); event.accepted = true; return }
            if (event.key === Qt.Key_Escape) {
              if (text !== "") root.clearSearch()
              else root.returnFocusToList()
              event.accepted = true
            }
          }
        }

        Row {
          width: parent.width
          spacing: Style.space(6)
          visible: !root.ui.searching

          Repeater {
            model: [
              { key: "o", label: "Overview" }, { key: "p", label: "Projects" }, { key: "c", label: "Containers" },
              { key: "s", label: "Services" }, { key: "m", label: "Machines" }, { key: "a", label: "Attention" },
              { key: "t", label: "Tools" }
            ]
            delegate: Text {
              required property var modelData
              readonly property bool current: Model.sectionForKey(modelData.key) === root.ui.view
              text: modelData.label
              color: current ? Color.accent : root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: current
              textFormat: Text.PlainText
              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.jump(modelData.key)
              }
            }
          }
        }

        PanelSeparator { width: parent.width; foreground: root.foreground }
      }

      Flickable {
        id: panelFlick
        anchors.top: header.bottom
        anchors.topMargin: Style.space(8)
        anchors.bottom: hints.top
        anchors.bottomMargin: Style.space(8)
        anchors.left: parent.left
        anchors.right: parent.right
        contentWidth: width
        contentHeight: rowColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: rowColumn
          width: panelFlick.width
          spacing: Style.space(2)

          Repeater {
            id: rowRepeater
            model: root.rows

            // One delegate covers every row type. A Loader per row would need
            // each variant in its own Component, and a Component declared at
            // panel scope cannot see the delegate's `modelData` — so the
            // variants live here and switch on `visible` instead.
            delegate: Item {
              id: rowItem
              required property int index
              required property var modelData

              readonly property bool selected: root.ui.index === index
              readonly property bool selectable: modelData.type === "item" || modelData.type === "action"
              readonly property bool isAction: modelData.type === "action"
              readonly property bool destructive: modelData.destructive === true
              readonly property string glyph: isAction ? "›" : (modelData.icon || "")
              readonly property color glyphColor: destructive ? Color.urgent
                : glyph === "✕" ? Color.urgent
                : glyph === "⚠" ? Color.accent
                : isAction ? root.dim
                : root.foreground

              width: rowColumn.width
              implicitHeight: modelData.type === "header" ? headerPart.implicitHeight
                : modelData.type === "empty" ? emptyPart.implicitHeight
                : modelData.type === "info" ? infoPart.implicitHeight
                : modelData.type === "hero" ? heroPart.implicitHeight
                : rowPart.implicitHeight

              PanelSectionHeader {
                id: headerPart
                visible: rowItem.modelData.type === "header"
                anchors.left: parent.left
                anchors.bottom: parent.bottom
                anchors.bottomMargin: Style.space(2)
                topPadding: Style.space(10)
                text: visible ? rowItem.modelData.label : ""
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Text {
                id: emptyPart
                visible: rowItem.modelData.type === "empty"
                width: parent.width
                topPadding: Style.space(6)
                bottomPadding: Style.space(6)
                leftPadding: Style.space(10)
                text: visible ? rowItem.modelData.label : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.bodySmall
                wrapMode: Text.WordWrap
                textFormat: Text.PlainText
              }

              Item {
                id: infoPart
                visible: rowItem.modelData.type === "info"
                width: parent.width
                implicitHeight: Math.max(infoLabel.implicitHeight, infoValue.implicitHeight) + Style.space(5)

                Text {
                  id: infoLabel
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.space(110)
                  text: infoPart.visible ? rowItem.modelData.label : ""
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  textFormat: Text.PlainText
                }
                Text {
                  id: infoValue
                  anchors.left: infoLabel.right
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  text: infoPart.visible ? rowItem.modelData.value : ""
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideMiddle
                  textFormat: Text.PlainText
                }
              }

              Item {
                id: heroPart
                visible: rowItem.modelData.type === "hero"
                width: parent.width
                implicitHeight: heroColumn.implicitHeight + Style.space(10)

                Text {
                  id: heroIcon
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(4)
                  anchors.top: parent.top
                  text: heroPart.visible ? rowItem.glyph : ""
                  color: rowItem.glyphColor
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.heading
                  textFormat: Text.PlainText
                }
                Column {
                  id: heroColumn
                  anchors.left: heroIcon.right
                  anchors.leftMargin: Style.space(10)
                  anchors.right: parent.right
                  anchors.top: parent.top

                  Text {
                    width: parent.width
                    text: heroPart.visible ? rowItem.modelData.title : ""
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.title
                    font.bold: true
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                  }
                  Text {
                    width: parent.width
                    text: heroPart.visible ? rowItem.modelData.subtitle : ""
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                    elide: Text.ElideMiddle
                    textFormat: Text.PlainText
                  }
                }
              }

              // Items and actions share one row: both are things you land on
              // and press Enter over, so they get the same cursor treatment.
              CursorSurface {
                id: rowPart
                visible: rowItem.selectable
                width: parent.width
                implicitHeight: rowText.implicitHeight + Style.spacing.controlPaddingY * 2
                foreground: root.foreground
                hasCursor: rowItem.selected

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: root.selectIndex(rowItem.index)
                  onClicked: { root.selectIndex(rowItem.index); root.activate() }
                }

                Text {
                  id: rowIcon
                  anchors.left: parent.left
                  anchors.leftMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.space(16)
                  text: rowPart.visible ? rowItem.glyph : ""
                  color: rowItem.glyphColor
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  textFormat: Text.PlainText
                }

                Column {
                  id: rowText
                  anchors.left: rowIcon.right
                  anchors.leftMargin: Style.space(6)
                  anchors.right: rowMeta.left
                  anchors.rightMargin: Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter

                  Text {
                    width: parent.width
                    text: rowPart.visible ? rowItem.modelData.title : ""
                    color: rowItem.destructive ? Color.urgent : root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: !rowItem.isAction
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                  }
                  Text {
                    width: parent.width
                    visible: rowPart.visible && !rowItem.isAction && rowItem.modelData.subtitle !== ""
                    text: visible ? rowItem.modelData.subtitle : ""
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                    textFormat: Text.PlainText
                  }
                }

                Text {
                  id: rowMeta
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  text: rowPart.visible && rowItem.modelData.meta ? rowItem.modelData.meta : ""
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  textFormat: Text.PlainText
                }
              }
            }
          }
        }
      }

      Column {
        id: hints
        anchors.bottom: parent.bottom
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: Style.space(4)

        PanelSeparator { width: parent.width; foreground: root.foreground }

        Text {
          width: parent.width
          text: root.ui.detail
            ? "↑↓ select   ⏎ run   esc back   r refresh"
            : root.ui.searching
              ? "↑↓ select   ⏎ open   esc clear   / search"
              : "↑↓ select   ⏎ open   / search   o p c s m a t sections   r refresh   esc close"
          color: Color.muted
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          horizontalAlignment: Text.AlignHCenter
          textFormat: Text.PlainText
        }
      }
    }

    ConfirmDialog {
      id: confirmDialog
      anchors.fill: parent
      z: 10
      opened: root.ui.confirm !== null
      message: root.confirmMessage
      confirmText: root.confirmAction ? root.confirmAction.label : "Confirm"
      background: Color.popups.background
      foreground: root.foreground
      fontFamily: root.fontFamily
      onOpenedChanged: {
        if (opened) forceActiveFocus()
        else root.returnFocusToList()
      }
      Keys.onPressed: function (event) { if (confirmDialog.handleKey(event)) event.accepted = true }
      onCanceled: root.back()
      onConfirmed: root.activate()
    }
  }
}
