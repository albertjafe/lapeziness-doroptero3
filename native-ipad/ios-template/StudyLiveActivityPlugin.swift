import ActivityKit
import Capacitor
import Foundation

@objc(StudyLiveActivityPlugin)
public class StudyLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StudyLiveActivityPlugin"
    public let jsName = "StudyLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingAction", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities requieren iPadOS 16.2 o posterior")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities estan desactivadas en Ajustes")
            return
        }
        guard let sessionID = call.getString("sessionId") else {
            call.reject("Falta sessionId")
            return
        }

        let attributes = StudyLiveActivityAttributes(
            sessionID: sessionID,
            workName: call.getString("workName") ?? "Sesion de estudio"
        )
        let content = ActivityContent(state: makeState(call), staleDate: nil)

        Task {
            for activity in Activity<StudyLiveActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            do {
                let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                call.resolve(["activityId": activity.id])
            } catch {
                call.reject("No se pudo iniciar la Live Activity", nil, error)
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let state = makeState(call)
        Task {
            guard let activity = matchingActivity(sessionID: call.getString("sessionId")) else {
                call.resolve(["updated": false])
                return
            }
            await activity.update(ActivityContent(state: state, staleDate: nil))
            call.resolve(["updated": true])
        }
    }

    @objc func extend(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let minutes = max(1, call.getInt("minutes") ?? 5)
        Task {
            guard let activity = Activity<StudyLiveActivityAttributes>.activities.first else {
                call.resolve(["updated": false])
                return
            }
            var state = activity.content.state
            guard let currentEnd = state.endsAt else {
                call.resolve(["updated": false])
                return
            }
            state.endsAt = currentEnd.addingTimeInterval(Double(minutes * 60))
            await activity.update(ActivityContent(state: state, staleDate: nil))
            call.resolve(["updated": true])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<StudyLiveActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    @objc func consumePendingAction(_ call: CAPPluginCall) {
        call.resolve(StudyPendingActions.consume())
    }

    @available(iOS 16.2, *)
    private func matchingActivity(sessionID: String?) -> Activity<StudyLiveActivityAttributes>? {
        guard let sessionID else { return Activity<StudyLiveActivityAttributes>.activities.first }
        return Activity<StudyLiveActivityAttributes>.activities.first(where: { $0.attributes.sessionID == sessionID })
    }

    private func makeState(_ call: CAPPluginCall) -> StudyLiveActivityAttributes.ContentState {
        let startedAtMs = call.getDouble("startedAt") ?? Date().timeIntervalSince1970 * 1000
        let endsAtMs = call.getDouble("endsAt")
        return StudyLiveActivityAttributes.ContentState(
            mode: call.getString("mode") ?? "stopwatch",
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
            endsAt: endsAtMs.map { Date(timeIntervalSince1970: $0 / 1000) },
            isPaused: call.getBool("isPaused") ?? false,
            elapsedSeconds: max(0, (call.getInt("elapsedMs") ?? 0) / 1000)
        )
    }
}

