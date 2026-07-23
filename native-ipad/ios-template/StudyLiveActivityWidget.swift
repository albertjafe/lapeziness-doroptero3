import ActivityKit
import SwiftUI
import WidgetKit

@main
struct StudyWidgetBundle: WidgetBundle {
    var body: some Widget {
        StudyLiveActivityWidget()
    }
}

struct StudyLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: StudyLiveActivityAttributes.self) { context in
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(context.state.mode == "timer" ? "TEMPORIZADOR" : "CRONOMETRO")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    Text(context.attributes.workName)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .lineLimit(1)
                    StudyTimerText(state: context.state)
                        .font(.system(size: 29, weight: .medium, design: .monospaced))
                        .monospacedDigit()
                }
                Spacer(minLength: 8)
                StudyActivityActions(context: context)
            }
            .padding(14)
            .activityBackgroundTint(Color(red: 0.10, green: 0.09, blue: 0.08))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Estudio", systemImage: "music.note")
                        .font(.caption.weight(.semibold))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StudyTimerText(state: context.state)
                        .font(.headline.monospacedDigit())
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(context.attributes.workName)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer()
                        StudyActivityActions(context: context)
                    }
                }
            } compactLeading: {
                Image(systemName: "music.note")
            } compactTrailing: {
                StudyTimerText(state: context.state)
                    .font(.caption2.monospacedDigit())
            } minimal: {
                Image(systemName: "timer")
            }
            .keylineTint(Color(red: 0.79, green: 0.66, blue: 0.43))
        }
    }
}

private struct StudyActivityActions: View {
    let context: ActivityViewContext<StudyLiveActivityAttributes>

    var body: some View {
        HStack(spacing: 8) {
            if context.state.mode == "timer" {
                Button(intent: ExtendStudyTimerIntent(activityID: context.activityID)) {
                    Text("+5")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                }
                .buttonStyle(.bordered)
                .tint(Color(red: 0.79, green: 0.66, blue: 0.43))
                .accessibilityLabel("Anadir cinco minutos")
            }
            Button(intent: EndStudyTimerIntent(activityID: context.activityID)) {
                Image(systemName: "stop.fill")
                    .font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.75, green: 0.29, blue: 0.29))
            .accessibilityLabel("Terminar sesion")
        }
    }
}

private struct StudyTimerText: View {
    let state: StudyLiveActivityAttributes.ContentState

    var body: some View {
        if state.isPaused {
            Text(Self.duration(state.elapsedSeconds))
        } else if let endsAt = state.endsAt {
            Text(endsAt, style: .timer)
        } else {
            Text(state.startedAt, style: .timer)
        }
    }

    private static func duration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let remainder = seconds % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remainder)
        }
        return String(format: "%02d:%02d", minutes, remainder)
    }
}

