import Capacitor

class StudyBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(StudyLiveActivityPlugin())
    }
}

