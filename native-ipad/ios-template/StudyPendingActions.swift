import Foundation

enum StudyPendingActions {
    private static let extendKey = "studyLiveActivity.pendingExtendMinutes"
    private static let endedAtKey = "studyLiveActivity.pendingEndedAt"

    static func addExtension(minutes: Int) {
        let defaults = UserDefaults.standard
        defaults.set(defaults.integer(forKey: extendKey) + max(0, minutes), forKey: extendKey)
    }

    static func markEnded(at date: Date) {
        UserDefaults.standard.set(date.timeIntervalSince1970 * 1000, forKey: endedAtKey)
    }

    static func consume() -> [String: Any] {
        let defaults = UserDefaults.standard
        let minutes = defaults.integer(forKey: extendKey)
        let endedAt = defaults.double(forKey: endedAtKey)
        defaults.removeObject(forKey: extendKey)
        defaults.removeObject(forKey: endedAtKey)
        return [
            "extendMinutes": minutes,
            "endedAt": endedAt,
        ]
    }
}

