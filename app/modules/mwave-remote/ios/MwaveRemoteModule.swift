// Кнопки «следующая» и «предыдущая» на экране блокировки, в Пункте управления и в наушниках (AirPods, Bluetooth).
// iOS присылает их через MPRemoteCommandCenter; модуль передаёт нажатия в JavaScript событиями.
import ExpoModulesCore
import MediaPlayer

public class MwaveRemoteModule: Module {
  private var nextTarget: Any?
  private var previousTarget: Any?

  public func definition() -> ModuleDefinition {
    Name("MwaveRemote")
    Events("onRemoteNext", "onRemotePrevious")

    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        self.apply(enabled)
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        self.apply(false)
      }
    }
  }

  private func apply(_ enabled: Bool) {
    let center = MPRemoteCommandCenter.shared()
    if let target = nextTarget {
      center.nextTrackCommand.removeTarget(target)
      nextTarget = nil
    }
    if let target = previousTarget {
      center.previousTrackCommand.removeTarget(target)
      previousTarget = nil
    }
    center.nextTrackCommand.isEnabled = enabled
    center.previousTrackCommand.isEnabled = enabled
    guard enabled else { return }
    nextTarget = center.nextTrackCommand.addTarget { [weak self] _ in
      self?.sendEvent("onRemoteNext", [:])
      return .success
    }
    previousTarget = center.previousTrackCommand.addTarget { [weak self] _ in
      self?.sendEvent("onRemotePrevious", [:])
      return .success
    }
  }
}
