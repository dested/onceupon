import AVFoundation
import ExpoModulesCore
import Speech

// On-device ears for the iPad (iPadOS 26+): SpeechAnalyzer + SpeechTranscriber fed from one
// AVAudioEngine mic tap. The same tap writes the span to an m4a so the studio keeps the child's
// voice clip (the WebView's own mic is not opened while these ears listen). Events:
//   onReady  {}                                     capturing and transcribing (after any model download)
//   onResult { finals: [String], volatile: String } every finalized segment so far + the live tail
//   onLevel  { level: Double }                      loudness 0..1, ~10x a second
//   onError  { code: String, message: String }        codes: not-allowed, interrupted, model, unsupported-locale, transcriber (JS maps the rest to failed)
//   onEnd    {}                                     also after an interruption (onError interrupted first)
// The JS side (index.ts) falls back to SFSpeechRecognizer when `isAvailable` is false.
public class OnDeviceEarsModule: Module {
  private var runner: AnyObject?

  public func definition() -> ModuleDefinition {
    Name("OnDeviceEars")

    Events("onReady", "onResult", "onLevel", "onError", "onEnd")

    AsyncFunction("isAvailable") { (locale: String) async -> Bool in
      if #available(iOS 26.0, *) {
        return await AnalyzerRunner.supports(locale: locale)
      }
      return false
    }

    // Gets the language model onto the device ahead of the first story: no prompt, no mic.
    AsyncFunction("prepare") { (locale: String) async -> Bool in
      if #available(iOS 26.0, *) {
        return await AnalyzerRunner.prepare(locale: locale)
      }
      return false
    }

    AsyncFunction("start") { (locale: String, recordPath: String?) async throws -> Bool in
      guard #available(iOS 26.0, *) else {
        throw EarsError("unavailable", "on-device ears need iPadOS 26")
      }
      if let old = self.runner as? AnalyzerRunner {
        _ = await old.stop()
      }
      let r = AnalyzerRunner(emit: { [weak self] name, body in self?.sendEvent(name, body) })
      self.runner = r
      do {
        try await r.start(locale: locale, recordPath: recordPath)
        return true
      } catch {
        self.runner = nil
        throw error
      }
    }

    AsyncFunction("stop") { () async -> [String: Any]? in
      guard #available(iOS 26.0, *), let r = self.runner as? AnalyzerRunner else { return nil }
      self.runner = nil
      return await r.stop()
    }
  }
}

/// The reason carries the code first ("not-allowed: ..."), which the studio matches on.
final class EarsError: Exception {
  private let text: String
  init(_ code: String, _ reason: String) {
    self.text = "\(code): \(reason)"
    super.init()
  }
  override var reason: String { text }
}

@available(iOS 26.0, *)
final class AnalyzerRunner {
  private let emit: (String, [String: Any]) -> Void
  private let engine = AVAudioEngine()
  private var analyzer: SpeechAnalyzer?
  private var transcriber: SpeechTranscriber?
  private var inputBuilder: AsyncStream<AnalyzerInput>.Continuation?
  private var resultsTask: Task<Void, Never>?
  private var converter: AVAudioConverter?
  private var analyzerFormat: AVAudioFormat?
  private var file: AVAudioFile?
  private var fileURL: URL?
  private var startedAt = Date()
  private var lastLevelAt = Date.distantPast
  private var finals: [String] = []
  private var volatile = ""
  private let lock = NSLock()
  private var watch: EarsInterruptWatch?
  private var stopTask: Task<[String: Any]?, Never>?

  init(emit: @escaping (String, [String: Any]) -> Void) {
    self.emit = emit
  }

  static func matchLocale(_ identifier: String) async -> Locale? {
    let want = Locale(identifier: identifier).identifier(.bcp47)
    let supported = await SpeechTranscriber.supportedLocales
    return supported.first { $0.identifier(.bcp47) == want }
  }

  static func supports(locale: String) async -> Bool {
    return await matchLocale(locale) != nil
  }

  static func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
    return SpeechTranscriber(
      locale: locale,
      transcriptionOptions: [],
      reportingOptions: [.volatileResults],
      attributeOptions: []
    )
  }

  /// Downloads and installs the model for the locale if it is missing. True once it is on the device.
  static func prepare(locale identifier: String) async -> Bool {
    guard let locale = await matchLocale(identifier) else { return false }
    do {
      try await installModel(for: makeTranscriber(locale))
      return true
    } catch {
      return false
    }
  }

  /// First use downloads the language model (needs the network once).
  static func installModel(for transcriber: SpeechTranscriber) async throws {
    do {
      if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await request.downloadAndInstall()
      }
    } catch {
      throw EarsError("model", error.localizedDescription)
    }
  }

  func start(locale identifier: String, recordPath: String?) async throws {
    guard let locale = await AnalyzerRunner.matchLocale(identifier) else {
      throw EarsError("unsupported-locale", "no on-device model for \(identifier)")
    }
    guard await AVAudioApplication.requestRecordPermission() else {
      throw EarsError("not-allowed", "microphone permission denied")
    }

    let transcriber = AnalyzerRunner.makeTranscriber(locale)
    self.transcriber = transcriber
    try await AnalyzerRunner.installModel(for: transcriber)

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    self.analyzer = analyzer
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
      throw EarsError("no-format", "the analyzer offered no audio format")
    }
    self.analyzerFormat = format

    let (stream, builder) = AsyncStream<AnalyzerInput>.makeStream()
    self.inputBuilder = builder

    resultsTask = Task { [weak self] in
      do {
        for try await result in transcriber.results {
          guard let self else { return }
          let text = String(result.text.characters)
          self.lock.lock()
          if result.isFinal {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { self.finals.append(trimmed) }
            self.volatile = ""
          } else {
            self.volatile = text.trimmingCharacters(in: .whitespacesAndNewlines)
          }
          let body: [String: Any] = ["finals": self.finals, "volatile": self.volatile]
          self.lock.unlock()
          self.emit("onResult", body)
        }
      } catch {
        self?.emit("onError", ["code": "transcriber", "message": error.localizedDescription])
      }
    }

    let session = AVAudioSession.sharedInstance()
    // Bluetooth keeps AirPods as the route while listening instead of moving output to the speaker.
    try session.setCategory(
      .playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP, .allowBluetooth])
    try session.setActive(true)

    if let recordPath, let url = recordPath.hasPrefix("file:") ? URL(string: recordPath) : Optional(URL(fileURLWithPath: recordPath)) {
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: Int(format.channelCount),
        AVEncoderBitRateKey: 32000,
      ]
      // No clip is better than no ears: a writer that cannot open is skipped.
      file = try? AVAudioFile(forWriting: url, settings: settings, commonFormat: format.commonFormat, interleaved: format.isInterleaved)
      fileURL = file != nil ? url : nil
    }

    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    try engine.start()
    try await analyzer.start(inputSequence: stream)
    startedAt = Date()
    watch = EarsInterruptWatch(engine: engine) { [weak self] why in self?.interrupted(why) }
    emit("onReady", [:])
  }

  private func handle(_ buffer: AVAudioPCMBuffer) {
    level(buffer)
    guard let format = analyzerFormat, let converted = convert(buffer, to: format) else { return }
    inputBuilder?.yield(AnalyzerInput(buffer: converted))
    if let file {
      do {
        try file.write(from: converted)
      } catch {
        self.file = nil
        self.fileURL = nil
      }
    }
  }

  private func level(_ buffer: AVAudioPCMBuffer) {
    let now = Date()
    guard now.timeIntervalSince(lastLevelAt) >= 0.1, let data = buffer.floatChannelData else { return }
    lastLevelAt = now
    let n = Int(buffer.frameLength)
    guard n > 0 else { return }
    var sum: Float = 0
    let samples = data[0]
    for i in 0..<n {
      sum += samples[i] * samples[i]
    }
    let rms = (sum / Float(n)).squareRoot()
    emit("onLevel", ["level": Double(min(1, rms * 6))])
  }

  private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
    if buffer.format == format { return buffer }
    if converter == nil || converter?.inputFormat != buffer.format {
      converter = AVAudioConverter(from: buffer.format, to: format)
      converter?.primeMethod = .none
    }
    guard let converter else { return nil }
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    let status = converter.convert(to: out, error: &error) { _, inputStatus in
      if consumed {
        inputStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      inputStatus.pointee = .haveData
      return buffer
    }
    if status == .error || out.frameLength == 0 { return nil }
    return out
  }

  /// Something outside the app stopped capture: say so, then end as if stopped (the clip is kept for `stop`).
  private func interrupted(_ why: String) {
    emit("onError", ["code": "interrupted", "message": why])
    Task { _ = await self.stop() }
  }

  /** Stops capture, finishes the transcript, closes the clip. Returns the clip, if any. Safe to call twice: an interruption stops first, the studio's `speech.stop` gets the same clip. */
  func stop() async -> [String: Any]? {
    lock.lock()
    let task: Task<[String: Any]?, Never>
    if let existing = stopTask {
      task = existing
    } else {
      task = Task { await self.teardown() }
      stopTask = task
    }
    lock.unlock()
    return await task.value
  }

  private func teardown() async -> [String: Any]? {
    watch?.cancel()
    watch = nil
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    inputBuilder?.finish()
    inputBuilder = nil
    if let analyzer {
      try? await analyzer.finalizeAndFinishThroughEndOfInput()
    }
    resultsTask?.cancel()
    resultsTask = nil
    analyzer = nil
    transcriber = nil
    let ms = Int(Date().timeIntervalSince(startedAt) * 1000)
    file = nil // closes the writer
    let url = fileURL
    fileURL = nil
    try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
    emit("onEnd", [:])
    guard let url else { return nil }
    return ["uri": url.absoluteString, "ms": ms]
  }
}

/// Calls `onStop` once when something outside the app stops capture: a call, Siri or an alarm
/// (interruption began), a headset or AirPods coming or going (route change), or an engine reset
/// (`AVAudioEngineConfigurationChange`). The runner then reports `interrupted` and ends.
final class EarsInterruptWatch {
  private var tokens: [NSObjectProtocol] = []
  private let lock = NSLock()
  private var fired = false

  init(engine: AVAudioEngine, onStop: @escaping (String) -> Void) {
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    let fire: (String) -> Void = { [weak self] why in
      guard let self else { return }
      self.lock.lock()
      let first = !self.fired
      self.fired = true
      self.lock.unlock()
      if first { onStop(why) }
    }
    tokens.append(
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          AVAudioSession.InterruptionType(rawValue: raw) == .began
        else { return }
        fire("the audio session was interrupted (a call, Siri or an alarm)")
      })
    tokens.append(
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: nil) { note in
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
          let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
        else { return }
        if reason == .oldDeviceUnavailable { fire("the audio device went away") }
        if reason == .newDeviceAvailable { fire("a new audio device connected") }
      })
    tokens.append(
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { _ in
        fire("the audio engine reset")
      })
  }

  /// Stops watching; after this `onStop` never fires.
  func cancel() {
    lock.lock()
    fired = true
    lock.unlock()
    for token in tokens { NotificationCenter.default.removeObserver(token) }
    tokens.removeAll()
  }
}
