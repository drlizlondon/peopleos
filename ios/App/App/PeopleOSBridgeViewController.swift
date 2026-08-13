import Capacitor

@objc(PeopleOSBridgeViewController)
public final class PeopleOSBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        super.capacitorDidLoad()
#if !PEOPLEOS_PERSONAL_TEAM
        bridge?.registerPluginInstance(PeopleOSCloudSyncPlugin())
#endif
        bridge?.registerPluginInstance(PeopleOSContactsPlugin())
    }
}
