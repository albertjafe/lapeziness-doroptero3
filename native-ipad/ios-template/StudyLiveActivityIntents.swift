import ActivityKit
import AppIntents
import Foundation

@available(iOS 17.0, *)
struct ExtendStudyTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Anadir cinco minutos"

    @Parameter(title: "Actividad")
    var activityID: String

    init() {}

    init(activityID: String) {
        self.activityID = activityID
    }

    func perform() async throws -> some IntentResult {
        guard let activity = Activity<StudyLiveActivityAttributes>.activities.first(where: { $0.id == activityID }) else {
            return .result()
        }
        var state = activity.content.state
        guard let currentEnd = state.endsAt else { return .result() }
        state.endsAt = currentEnd.addingTimeInterval(5 * 60)
        let content = ActivityContent(state: state, staleDate: nil)
        await activity.update(content)
        StudyPendingActions.addExtension(minutes: 5)
        return .result()
    }
}

@available(iOS 17.0, *)
struct EndStudyTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Terminar sesion"

    @Parameter(title: "Actividad")
    var activityID: String

    init() {}

    init(activityID: String) {
        self.activityID = activityID
    }

    func perform() async throws -> some IntentResult {
        guard let activity = Activity<StudyLiveActivityAttributes>.activities.first(where: { $0.id == activityID }) else {
            return .result()
        }
        let endedAt = Date()
        StudyPendingActions.markEnded(at: endedAt)
        await activity.end(activity.content, dismissalPolicy: .immediate)
        return .result()
    }
}

