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
    Constants(["isSimulator": Self.simulator])
    Function("setTimeline") { (elapsed: Double, duration: Double, playing: Bool) in
      DispatchQueue.main.async {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      }
    }
    // CI exercises the same event bridge in a simulator. This method is absent on devices.
    #if targetEnvironment(simulator)
    Function("saveQAResult") { (json: String) in
      let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      try json.write(to: folder.appendingPathComponent("mwave-native-qa.json"), atomically: true, encoding: .utf8)
    }
    Function("simulateCommand") { (command: String) in
      if command == "next" { self.sendEvent("onRemoteNext", [:]) }
      if command == "previous" { self.sendEvent("onRemotePrevious", [:]) }
    }
    #endif

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

  private static var simulator: Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return false
    #endif
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
