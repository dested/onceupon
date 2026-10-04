import AVFoundation
import ExpoModulesCore

// Whistle ears: the Cactus Whistle speech model (whistle.cact, 17 MB) on the needle engine
// (Needle.xcframework), on any iPad this app runs on. The engine transcribes one clip at a time
// (16 kHz mono, 30 s at most) and has no streaming, so the runner fakes it: the mic tap grows an
// utterance buffer, the decode loop re-transcribes it every ~0.4 s as the live tail, and a pause
// (or 24 s of talking) commits it as a finished segment. Same events as OnDeviceEars:
//   onReady  {}                                     capturing and transcribing (model loaded)
//   onResult { finals: [String], volatile: String } every finished segment so far + the live tail
//   onLevel  { level: Double }                      loudness 0..1, ~10x a second
//   onError  { code: String, message: String }
//   onEnd    {}
public class WhistleEarsModule: Module {
  private var runner: WhistleRunner?

  public func definition() -> ModuleDefinition {
    Name("WhistleEars")

    Events("onReady", "onResult", "onLevel", "onError", "onEnd")

    AsyncFunction("isAvailable") { (locale: String) -> Bool in
      return WhistleModel.language(for: locale) != nil && WhistleModel.weightsURL() != nil
    }

    AsyncFunction("start") { (locale: String, recordPath: String?) async throws -> Bool in
      if let old = self.runner {
        _ = await old.stop()
      }
      let r = WhistleRunner(emit: { [weak self] name, body in self?.sendEvent(name, body) })
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
      guard let r = self.runner else { return nil }
      self.runner = nil
      return await r.stop()
    }
  }
}

/// The reason carries the code first ("not-allowed: ..."), which the studio matches on.
final class WhistleError: Exception {
  private let text: String
  init(_ code: String, _ reason: String) {
    self.text = "\(code): \(reason)"
    super.init()
  }
  override var reason: String { text }
}

/// The engine holds one process-global speech model and is not thread-safe: every call into it
/// runs on `queue`.
enum WhistleModel {
  static let queue = DispatchQueue(label: "whistle.decode", qos: .userInitiated)
  private static let languages: Set<String> = ["en", "de", "fr", "es", "it", "nl", "pl"]
  private static var loaded = false

  static func language(for locale: String) -> String? {
    let code = String(locale.prefix(2)).lowercased()
    return languages.contains(code) ? code : nil
  }

  static func weightsURL() -> URL? {
    for base in [Bundle.main, Bundle(for: WhistleEarsModule.self)] {
      if let url = base.url(forResource: "whistle", withExtension: "cact") { return url }
      if let nested = base.url(forResource: "WhistleEars", withExtension: "bundle"),
        let bundle = Bundle(url: nested),
        let url = bundle.url(forResource: "whistle", withExtension: "cact")
      {
        return url
      }
    }
    return nil
  }

  private static func lastError() -> String {
    guard let c = needle_last_error() else { return "unknown engine error" }
    return String(cString: c)
  }

  /// Maps the weights and hands them to the engine once. The mapping is never released: the engine
  /// reads the archive in place for as long as the process lives.
  static func loadIfNeeded() throws {
    if loaded { return }
    guard let url = weightsURL() else {
      throw WhistleError("no-weights", "whistle.cact is not in this build")
    }
    let fd = open(url.path, O_RDONLY)
    guard fd >= 0 else {
      throw WhistleError("no-weights", "whistle.cact could not be opened")
    }
    defer { close(fd) }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_size > 0 else {
      throw WhistleError("no-weights", "whistle.cact is empty")
    }
    let size = Int(info.st_size)
    guard let map = mmap(nil, size, PROT_READ, MAP_PRIVATE, fd, 0), map != MAP_FAILED else {
      throw WhistleError("no-weights", "whistle.cact could not be mapped")
    }
    let rc = needle_load(map.assumingMemoryBound(to: UInt8.self), UInt64(size))
    if rc < 0 {
      let message = lastError()
      munmap(map, size)
      throw WhistleError("load", message)
    }
    loaded = true
  }

  /// The transcript of one clip ('' for silence, noise or an engine failure).
  static func transcribe(_ samples: [Float], language: String) -> String {
    if samples.isEmpty { return "" }
    var out = [CChar](repeating: 0, count: 16384)
    let capacity = Int32(out.count)
    let rc = samples.withUnsafeBufferPointer { pcm -> Int32 in
      out.withUnsafeMutableBufferPointer { buf -> Int32 in
        needle_transcribe(pcm.baseAddress, Int32(pcm.count), language, nil, 0, buf.baseAddress, capacity)
      }
    }
    if rc < 0 { return "" }
    out[out.count - 1] = 0
    let json = String(cString: out)
    guard let data = json.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data),
      let dict = parsed as? [String: Any],
      let text = dict["text"] as? String
    else { return "" }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

final class WhistleRunner {
  private static let sampleRate = 16000
  /// Converted-buffer RMS that counts as a voice (the studio's level is rms * 6; a quiet room sits under ~0.017).
  private static let voiceRms: Float = 0.02
  /// This much quiet after speech ends the utterance.
  private static let endQuiet = sampleRate * 6 / 10
  /// New audio needed before the live tail is decoded again.
  private static let interimStep = sampleRate * 4 / 10
  /// Audio kept from before the first loud frame, so the first word is not clipped.
  private static let preroll = sampleRate * 3 / 10
  /// A child who never pauses is cut here (the engine takes 30 s at most).
  private static let maxUtterance = sampleRate * 24
  /// Shorter leftovers at stop are not worth a decode.
  private static let minUtterance = sampleRate / 4

  private let emit: (String, [String: Any]) -> Void
  private let engine = AVAudioEngine()
  private var converter: AVAudioConverter?
  private var modelFormat: AVAudioFormat?
  private var file: AVAudioFile?
  private var fileURL: URL?
  private var startedAt = Date()
  private var lastLevelAt = Date.distantPast
  private var language = "en"

  // Shared between the audio tap and the decode loop; guarded by `lock`.
  private let lock = NSLock()
  private var utterance: [Float] = []
  private var voiced = false
  private var quietRun = 0
  private var running = false

  // Decode queue only.
  private var finals: [String] = []
  private var volatile = ""
  private var decodedCount = 0

  init(emit: @escaping (String, [String: Any]) -> Void) {
    self.emit = emit
  }

  private func micPermission() async -> Bool {
    if #available(iOS 17.0, *) {
      return await AVAudioApplication.requestRecordPermission()
    }
    return await withCheckedContinuation { cont in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        cont.resume(returning: granted)
      }
    }
  }

  func start(locale: String, recordPath: String?) async throws {
    guard let language = WhistleModel.language(for: locale) else {
      throw WhistleError("unsupported-locale", "whistle does not speak \(locale)")
    }
    self.language = language
    guard await micPermission() else {
      throw WhistleError("not-allowed", "microphone permission denied")
    }
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      WhistleModel.queue.async {
        do {
          try WhistleModel.loadIfNeeded()
          cont.resume()
        } catch {
          cont.resume(throwing: error)
        }
      }
    }
    guard
      let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: Double(WhistleRunner.sampleRate),
        channels: 1,
        interleaved: false
      )
    else {
      throw WhistleError("no-format", "16 kHz mono float is not available")
    }
    modelFormat = format

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers])
    try session.setActive(true)

    if let recordPath, let url = recordPath.hasPrefix("file:") ? URL(string: recordPath) : Optional(URL(fileURLWithPath: recordPath)) {
      let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: format.sampleRate,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
      ]
      // No clip is better than no ears: a writer that cannot open is skipped.
      file = try? AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
      fileURL = file != nil ? url : nil
    }

    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    guard inputFormat.sampleRate > 0 else {
      throw WhistleError("no-mic", "the microphone offered no audio format")
    }
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.handle(buffer)
    }
    engine.prepare()
    try engine.start()
    startedAt = Date()
    setRunning(true)
    WhistleModel.queue.async { [weak self] in self?.tick() }
    emit("onReady", [:])
  }

  private func setRunning(_ on: Bool) {
    lock.lock()
    running = on
    lock.unlock()
  }

  private func handle(_ buffer: AVAudioPCMBuffer) {
    level(buffer)
    guard let format = modelFormat, let converted = convert(buffer, to: format),
      let data = converted.floatChannelData
    else { return }
    if let file {
      do {
        try file.write(from: converted)
      } catch {
        self.file = nil
        self.fileURL = nil
      }
    }
    let n = Int(converted.frameLength)
    guard n > 0 else { return }
    let samples = UnsafeBufferPointer(start: data[0], count: n)
    var sum: Float = 0
    for s in samples {
      sum += s * s
    }
    let loud = (sum / Float(n)).squareRoot() >= WhistleRunner.voiceRms

    lock.lock()
    utterance.append(contentsOf: samples)
    if loud {
      voiced = true
      quietRun = 0
    } else {
      quietRun += n
      // Nothing said yet: keep only the preroll so silence never grows the buffer.
      if !voiced && utterance.count > WhistleRunner.preroll {
        utterance.removeFirst(utterance.count - WhistleRunner.preroll)
      }
    }
    lock.unlock()
  }

  /// One pass of the decode loop (decode queue): commit a finished utterance, or refresh the live tail.
  private func tick() {
    lock.lock()
    guard running else {
      lock.unlock()
      return
    }
    let count = utterance.count
    let ended = voiced && (quietRun >= WhistleRunner.endQuiet || count >= WhistleRunner.maxUtterance)
    let grown = voiced && count - decodedCount >= WhistleRunner.interimStep
    var snapshot: [Float]?
    if ended {
      snapshot = utterance
      utterance.removeAll(keepingCapacity: true)
      voiced = false
      quietRun = 0
    } else if grown {
      snapshot = utterance
    }
    lock.unlock()

    if let snapshot {
      let text = WhistleModel.transcribe(snapshot, language: language)
      if ended {
        commit(text)
      } else {
        decodedCount = snapshot.count
        if text != volatile {
          volatile = text
          emit("onResult", ["finals": finals, "volatile": volatile])
        }
      }
    }
    WhistleModel.queue.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.tick() }
  }

  /// Decode queue: the utterance is over, its text becomes a finished segment.
  private func commit(_ text: String) {
    let hadTail = !volatile.isEmpty
    decodedCount = 0
    volatile = ""
    if !text.isEmpty { finals.append(text) }
    if !text.isEmpty || hadTail {
      emit("onResult", ["finals": finals, "volatile": ""])
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

  /// Ends the loop and takes whatever was being said when the mic closed.
  private func takeRest() -> [Float] {
    lock.lock()
    defer { lock.unlock() }
    running = false
    let rest = voiced ? utterance : []
    utterance.removeAll()
    voiced = false
    quietRun = 0
    return rest
  }

  /** Stops capture, finishes the transcript, closes the clip. Returns the clip, if any. */
  func stop() async -> [String: Any]? {
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    let rest = takeRest()
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
      WhistleModel.queue.async {
        let text = rest.count >= WhistleRunner.minUtterance ? WhistleModel.transcribe(rest, language: self.language) : ""
        self.commit(text)
        cont.resume()
      }
    }
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
