import AdServices
import ExpoModulesCore

// Exposes Apple AdServices attribution to JS. `attributionToken()` returns the current token, or
// nil when the API is unavailable (before iOS 14.3, or when no token can be produced). The JS wrapper
// (modules/apple-attribution/index.ts) turns any failure into a null result.
public class AppleAttributionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleAttribution")

    AsyncFunction("attributionToken") { () -> String? in
      if #available(iOS 14.3, *) {
        return try? AAAttribution.attributionToken()
      }
      return nil
    }
  }
}
