import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar entry for the Developer Control Center.
//
// The widget itself holds no state: it reads the background service and
// renders one compact status — "DEV ●" when the environment is healthy,
// "DEV ⚠ 2" when something wants attention. All the work happens in
// Service.qml (discovery) and Panel.qml (the interface).
BarWidget {
  id: root
  moduleName: "io.github.juancasanueva.developer-control-center"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(root.moduleName) : null
  readonly property var barState: service ? service.barState : { glyph: "●", count: 0, active: 0, severity: "healthy" }
  readonly property var config: service ? service.config : Model.normalizeConfig({}, "")
  readonly property string label: Model.barText(barState, config, root.vertical)
  readonly property bool urgent: barState.severity !== "healthy"

  // Vertical bars are 28 px wide, so the label is stacked one glyph per line
  // rather than truncated into something unreadable.
  readonly property var verticalLines: label === "" ? [] : label.split("\n")

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  // The service is loaded once for the whole shell and is not given its
  // settings, so whichever bar instance sees them first hands them over.
  function pushSettings() {
    if (service && "settings" in service) service.settings = root.settings || ({})
  }

  // ---- Shape contract for shell.summon/hide/toggle routing:
  //      Bar.findPanelWidget requires open/close/opened on the bar-widget
  //      root, so these delegate down to the loaded panel.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function refresh() {
    if (service) service.refreshAll()
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: { injectPanel(); pushSettings() }
  onSettingsChanged: { injectPanel(); pushSettings() }
  onServiceChanged: pushSettings()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "io.github.juancasanueva.developer-control-center"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    function refresh(): string { root.broadcast("refresh"); return "ok" }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.vertical ? "" : root.label
    labelVisible: !root.vertical
    hasVisualContent: root.vertical ? root.verticalLines.length > 0 : text !== ""
    fixedHeight: root.vertical ? root.verticalLines.length * Style.bar.iconSlot : -1
    active: root.urgent
    tooltipText: root.barState.severity === "error"
      ? "Developer Control Center · " + root.barState.count + " needing attention"
      : root.barState.severity === "warning"
        ? "Developer Control Center · " + root.barState.count + " warning" + (root.barState.count === 1 ? "" : "s")
        : "Developer Control Center · nothing needs attention"

    // Middle click rescans everything without opening anything — the same
    // "refresh in place" gesture the weather and clock widgets use.
    onPressed: function(b) {
      if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }

    Column {
      visible: root.vertical
      anchors.fill: parent
      Repeater {
        model: root.verticalLines
        OpticalGlyph {
          required property string modelData
          width: button.width
          height: Style.bar.iconSlot
          text: modelData
          fontFamily: button.fontFamily
          fontSize: button.fontSize
          color: button.foreground
        }
      }
    }
  }
}
