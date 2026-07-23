import ActivityKit
import Foundation

struct StudyLiveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var mode: String
        var startedAt: Date
        var endsAt: Date?
        var isPaused: Bool
        var elapsedSeconds: Int
    }

    var sessionID: String
    var workName: String
}

