type Props = {
  navigate: (path: string) => void;
};

export default function PrivacyScreen({ navigate }: Props) {
  return (
    <main className="screen data-screen privacy-screen" id="main-content" tabIndex={-1}>
      <button className="back-button" type="button" onClick={() => navigate("/settings")}>← Settings</button>
      <header className="page-heading">
        <p className="eyebrow">Privacy</p>
        <h2>Your data stays under your control.</h2>
        <p>PeopleOS is local-first and does not sell personal data or use contact data for advertising.</p>
      </header>

      <section className="data-panel" aria-labelledby="privacy-local-first">
        <h3 id="privacy-local-first">Local-first by default</h3>
        <p>Your PeopleOS data is stored on this device. PeopleOS has no product account, hosted API, advertising profile or contact-data analytics.</p>
      </section>

      <section className="data-panel" aria-labelledby="privacy-icloud">
        <h3 id="privacy-icloud">Optional private iCloud Sync</h3>
        <p>If you turn on iCloud Sync, PeopleOS keeps copies in your private iCloud storage through Apple CloudKit. PeopleOS does not receive or display your Apple account identifier. Turning sync off stops future syncing on this iPhone but does not delete copies already held in iCloud.</p>
      </section>

      <section className="data-panel" aria-labelledby="privacy-notifications">
        <h3 id="privacy-notifications">Private Today reminders</h3>
        <p>Notifications are optional, scheduled on the iPhone and use no notification backend or remote push service. Previews contain only a count or general reminder—not names, contact details, notes or relationship details.</p>
      </section>

      <section className="data-panel" aria-labelledby="privacy-contacts">
        <h3 id="privacy-contacts">Selective Apple Contacts transfer</h3>
        <p>Apple's contact picker shares only the people you finish choosing, without giving PeopleOS general address-book access. PeopleOS imports only names, phone numbers, email addresses, organisation and job title.</p>
        <p>If you explicitly choose to save a new person to iPhone Contacts too, iOS asks for Contacts permission. PeopleOS never copies lists, reminders, notes, memories, history or other relationship data into the Apple contact. These are one-time transfers, not ongoing sync.</p>
      </section>

      <section className="data-panel" aria-labelledby="privacy-control">
        <h3 id="privacy-control">Your choices</h3>
        <p>You can edit or archive records, export and restore a JSON backup, turn reminders off, pause iCloud Sync, or remove PeopleOS and its local data through the operating system.</p>
        <p>For synced removals, PeopleOS retains a deletion marker—not the removed relationship content—for at least 180 days and at least 30 days after iCloud acknowledges it, whichever is later. This prevents an older copy from restoring the record. PeopleOS does not currently include a button to erase its entire private iCloud zone.</p>
        <p className="muted-copy">Last updated 11 August 2026.</p>
      </section>
    </main>
  );
}
