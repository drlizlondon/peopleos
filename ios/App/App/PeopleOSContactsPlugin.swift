import Foundation
import Contacts
import ContactsUI
import Capacitor
import UIKit

@objc(PeopleOSContactsPlugin)
public final class PeopleOSContactsPlugin: CAPPlugin, CAPBridgedPlugin, CNContactPickerDelegate {
    public let identifier = "PeopleOSContactsPlugin"
    public let jsName = "PeopleOSContacts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickContact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createContact", returnType: CAPPluginReturnPromise)
    ]

    private let idempotencyDefaultsKey = "peopleos.contacts.created-operations.v1"
    private let stateLock = NSLock()
    private var pendingPickerCall: CAPPluginCall?
    private var singlePickerDelegate: SingleContactPickerDelegate?

    @objc public func pickContact(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingPickerCall == nil else {
                call.reject("The contact picker is already open.", "picker_busy")
                return
            }
            guard let presenter = self.bridge?.viewController,
                  presenter.presentedViewController == nil else {
                call.reject("The contact picker is unavailable right now.", "unavailable")
                return
            }

            let picker = CNContactPickerViewController()
            // Keep this delegate separate from the bulk picker delegate below.
            // Implementing only the singular selection callback lets Apple's
            // standard picker provide its native searchable selection flow.
            let delegate = SingleContactPickerDelegate(
                onSelect: { [weak self] contact in
                    guard let self else { return }
                    self.finishPicker([
                        "status": "selected",
                        "contacts": [self.selectedContact(contact)]
                    ])
                },
                onCancel: { [weak self] in
                    self?.finishPicker(["status": "cancelled", "contacts": []])
                }
            )
            picker.delegate = delegate
            picker.displayedPropertyKeys = [
                CNContactPhoneNumbersKey,
                CNContactEmailAddressesKey,
                CNContactOrganizationNameKey,
                CNContactJobTitleKey
            ]
            self.pendingPickerCall = call
            self.singlePickerDelegate = delegate
            presenter.present(picker, animated: true)
        }
    }

    @objc public func pickContacts(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pendingPickerCall == nil else {
                call.reject("The contact picker is already open.", "picker_busy")
                return
            }
            guard let presenter = self.bridge?.viewController,
                  presenter.presentedViewController == nil else {
                call.reject("The contact picker is unavailable right now.", "unavailable")
                return
            }

            let picker = CNContactPickerViewController()
            picker.delegate = self
            picker.displayedPropertyKeys = [
                CNContactPhoneNumbersKey,
                CNContactEmailAddressesKey,
                CNContactOrganizationNameKey,
                CNContactJobTitleKey
            ]
            self.pendingPickerCall = call
            presenter.present(picker, animated: true)
        }
    }

    @objc public func createContact(_ call: CAPPluginCall) {
        let parsed: ParsedCreateContact
        do {
            parsed = try parseCreateContact(call)
        } catch {
            call.reject("The contact details are invalid.", "invalid_payload", error)
            return
        }

        if let identifier = createdContactIdentifier(for: parsed.operationId) {
            call.resolve(["status": "already_created", "contactIdentifier": identifier])
            return
        }

        let store = CNContactStore()
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .authorized || isLimited(status) {
            save(parsed, to: store, call: call)
            return
        }
        if status == .restricted {
            call.reject("iPhone Contacts access is restricted.", "permission_restricted")
            return
        }
        if status == .denied {
            call.reject("iPhone Contacts access was denied.", "permission_denied")
            return
        }
        guard status == .notDetermined else {
            call.reject("iPhone Contacts is unavailable.", "unavailable")
            return
        }

        store.requestAccess(for: .contacts) { granted, error in
            let resultingStatus = CNContactStore.authorizationStatus(for: .contacts)
            if granted || resultingStatus == .authorized || self.isLimited(resultingStatus) {
                self.save(parsed, to: store, call: call)
                return
            }
            if resultingStatus == .restricted {
                call.reject("iPhone Contacts access is restricted.", "permission_restricted", error)
            } else if resultingStatus == .denied {
                call.reject("iPhone Contacts access was denied.", "permission_denied", error)
            } else {
                call.reject("iPhone Contacts is unavailable.", "unavailable", error)
            }
        }
    }

    public func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        finishPicker(["status": "cancelled", "contacts": []])
    }

    public func contactPicker(
        _ picker: CNContactPickerViewController,
        didSelect contacts: [CNContact]
    ) {
        finishPicker([
            "status": "selected",
            "contacts": contacts.map(selectedContact)
        ])
    }

    private func finishPicker(_ result: [String: Any]) {
        let call = pendingPickerCall
        pendingPickerCall = nil
        singlePickerDelegate = nil
        call?.resolve(result)
    }

    private func selectedContact(_ contact: CNContact) -> [String: Any] {
        var result: [String: Any] = [
            "displayName": displayName(contact),
            "phoneNumbers": contactValues(contact, key: CNContactPhoneNumbersKey) {
                contact.phoneNumbers.map { labelled in
                    self.encodedValue(labelled.value.stringValue, label: labelled.label)
                }
            },
            "emailAddresses": contactValues(contact, key: CNContactEmailAddressesKey) {
                contact.emailAddresses.map { labelled in
                    self.encodedValue(labelled.value as String, label: labelled.label)
                }
            }
        ]
        if let organisation = availableString(contact, key: CNContactOrganizationNameKey, value: { contact.organizationName }) {
            result["organisation"] = organisation
        }
        if let jobTitle = availableString(contact, key: CNContactJobTitleKey, value: { contact.jobTitle }) {
            result["jobTitle"] = jobTitle
        }
        if let givenName = availableString(contact, key: CNContactGivenNameKey, value: { contact.givenName }) {
            result["givenName"] = givenName
        }
        return result
    }

    private func displayName(_ contact: CNContact) -> String {
        let nameFields: [(String, () -> String)] = [
            (CNContactNamePrefixKey, { contact.namePrefix }),
            (CNContactGivenNameKey, { contact.givenName }),
            (CNContactMiddleNameKey, { contact.middleName }),
            (CNContactFamilyNameKey, { contact.familyName }),
            (CNContactNameSuffixKey, { contact.nameSuffix })
        ]
        let name = nameFields.compactMap { key, value in
            availableString(contact, key: key, value: value)
        }.joined(separator: " ")
        if !name.isEmpty { return name }
        if let nickname = availableString(contact, key: CNContactNicknameKey, value: { contact.nickname }) {
            return nickname
        }
        return availableString(contact, key: CNContactOrganizationNameKey, value: { contact.organizationName }) ?? ""
    }

    private func availableString(
        _ contact: CNContact,
        key: String,
        value: () -> String
    ) -> String? {
        guard contact.isKeyAvailable(key) else { return nil }
        let trimmed = value().trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func contactValues(
        _ contact: CNContact,
        key: String,
        values: () -> [[String: Any]]
    ) -> [[String: Any]] {
        contact.isKeyAvailable(key) ? values() : []
    }

    private func encodedValue(_ value: String, label: String?) -> [String: Any] {
        var result: [String: Any] = ["value": value]
        if let label,
           !label.isEmpty {
            let localized = CNLabeledValue<NSString>.localizedString(forLabel: label)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !localized.isEmpty { result["label"] = localized }
        }
        return result
    }

    private func parseCreateContact(_ call: CAPPluginCall) throws -> ParsedCreateContact {
        guard let options = call.options as? [String: Any],
              Set(options.keys).isSubset(of: ["operationId", "contact"]),
              let operationId = options["operationId"] as? String,
              let contact = options["contact"] as? [String: Any] else {
            throw ContactsPayloadError.invalid
        }
        let normalizedOperationId = try requiredString(operationId, maximumLength: 500)
        let allowedKeys: Set<String> = [
            "displayName", "phoneNumbers", "emailAddresses", "organisation", "jobTitle"
        ]
        guard Set(contact.keys).isSubset(of: allowedKeys),
              let displayNameValue = contact["displayName"] as? String,
              let phoneValues = contact["phoneNumbers"] as? [[String: Any]],
              let emailValues = contact["emailAddresses"] as? [[String: Any]],
              phoneValues.count <= 50,
              emailValues.count <= 50 else {
            throw ContactsPayloadError.invalid
        }

        return ParsedCreateContact(
            operationId: normalizedOperationId,
            displayName: try requiredString(displayNameValue, maximumLength: 120),
            phoneNumbers: try phoneValues.map { try parseFieldValue($0, maximumLength: 500) },
            emailAddresses: try emailValues.map { try parseFieldValue($0, maximumLength: 320) },
            organisation: try optionalString(contact["organisation"], maximumLength: 200),
            jobTitle: try optionalString(contact["jobTitle"], maximumLength: 200)
        )
    }

    private func parseFieldValue(
        _ value: [String: Any],
        maximumLength: Int
    ) throws -> ParsedFieldValue {
        guard Set(value.keys).isSubset(of: ["value", "label"]),
              let rawValue = value["value"] as? String else {
            throw ContactsPayloadError.invalid
        }
        return ParsedFieldValue(
            value: try requiredString(rawValue, maximumLength: maximumLength),
            label: try optionalString(value["label"], maximumLength: 100)
        )
    }

    private func requiredString(_ value: String, maximumLength: Int) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maximumLength else {
            throw ContactsPayloadError.invalid
        }
        return trimmed
    }

    private func optionalString(_ value: Any?, maximumLength: Int) throws -> String? {
        guard let value else { return nil }
        guard let string = value as? String else { throw ContactsPayloadError.invalid }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        guard trimmed.count <= maximumLength else { throw ContactsPayloadError.invalid }
        return trimmed
    }

    private func isLimited(_ status: CNAuthorizationStatus) -> Bool {
        if #available(iOS 18.0, *) { return status == .limited }
        return false
    }

    private func save(
        _ parsed: ParsedCreateContact,
        to store: CNContactStore,
        call: CAPPluginCall
    ) {
        if let identifier = createdContactIdentifier(for: parsed.operationId) {
            call.resolve(["status": "already_created", "contactIdentifier": identifier])
            return
        }

        do {
            if let existingIdentifier = try accessibleExistingContactIdentifier(for: parsed, in: store) {
                rememberCreatedContact(identifier: existingIdentifier, operationId: parsed.operationId)
                call.resolve(["status": "already_exists", "contactIdentifier": existingIdentifier])
                return
            }
        } catch {
            rejectContactStoreError(error, call: call)
            return
        }

        let contact = CNMutableContact()
        contact.givenName = parsed.displayName
        contact.phoneNumbers = parsed.phoneNumbers.map { field in
            CNLabeledValue(
                label: appleLabel(field.label),
                value: CNPhoneNumber(stringValue: field.value)
            )
        }
        contact.emailAddresses = parsed.emailAddresses.map { field in
            CNLabeledValue(label: appleLabel(field.label), value: field.value as NSString)
        }
        contact.organizationName = parsed.organisation ?? ""
        contact.jobTitle = parsed.jobTitle ?? ""

        let request = CNSaveRequest()
        request.add(contact, toContainerWithIdentifier: nil)
        do {
            try store.execute(request)
            rememberCreatedContact(identifier: contact.identifier, operationId: parsed.operationId)
            call.resolve(["status": "created", "contactIdentifier": contact.identifier])
        } catch {
            let value = error as NSError
            if value.domain == CNErrorDomain && value.code == CNError.Code.insertedRecordAlreadyExists.rawValue {
                rememberCreatedContact(identifier: contact.identifier, operationId: parsed.operationId)
                call.resolve(["status": "already_exists", "contactIdentifier": contact.identifier])
            } else if value.domain == CNErrorDomain && value.code == CNError.Code.authorizationDenied.rawValue {
                call.reject("iPhone Contacts access was denied.", "permission_denied", error)
            } else if isContactsUnavailableError(value) {
                call.reject("iPhone Contacts is unavailable.", "unavailable", error)
            } else {
                call.reject("PeopleOS could not add this person to iPhone Contacts.", "write_failed", error)
            }
        }
    }

    private func accessibleExistingContactIdentifier(
        for parsed: ParsedCreateContact,
        in store: CNContactStore
    ) throws -> String? {
        let identifierOnly = [CNContactIdentifierKey as CNKeyDescriptor]
        for phone in parsed.phoneNumbers {
            let predicate = CNContact.predicateForContacts(
                matching: CNPhoneNumber(stringValue: phone.value)
            )
            if let match = try store.unifiedContacts(
                matching: predicate,
                keysToFetch: identifierOnly
            ).first {
                return match.identifier
            }
        }
        for email in parsed.emailAddresses {
            let predicate = CNContact.predicateForContacts(matchingEmailAddress: email.value)
            if let match = try store.unifiedContacts(
                matching: predicate,
                keysToFetch: identifierOnly
            ).first {
                return match.identifier
            }
        }
        return nil
    }

    private func rejectContactStoreError(_ error: Error, call: CAPPluginCall) {
        let value = error as NSError
        if value.domain == CNErrorDomain && value.code == CNError.Code.authorizationDenied.rawValue {
            call.reject("iPhone Contacts access was denied.", "permission_denied", error)
        } else if isContactsUnavailableError(value) {
            call.reject("iPhone Contacts is unavailable.", "unavailable", error)
        } else {
            call.reject("PeopleOS could not check iPhone Contacts.", "write_failed", error)
        }
    }

    private func appleLabel(_ label: String?) -> String? {
        guard let label else { return nil }
        switch label.lowercased() {
        case "home": return CNLabelHome
        case "work": return CNLabelWork
        case "mobile": return CNLabelPhoneNumberMobile
        case "iphone": return CNLabelPhoneNumberiPhone
        case "main": return CNLabelPhoneNumberMain
        case "other": return CNLabelOther
        default: return label
        }
    }

    private func isContactsUnavailableError(_ error: NSError) -> Bool {
        guard error.domain == CNErrorDomain else { return false }
        if error.code == CNError.Code.noAccessableWritableContainers.rawValue
            || error.code == CNError.Code.featureDisabledByUser.rawValue {
            return true
        }
        if #available(iOS 17.0, *) {
            return error.code == CNError.Code.featureNotAvailable.rawValue
        }
        return false
    }

    private func createdContactIdentifier(for operationId: String) -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        let records = UserDefaults.standard.dictionary(forKey: idempotencyDefaultsKey) as? [String: String]
        return records?[operationId]
    }

    private func rememberCreatedContact(identifier: String, operationId: String) {
        stateLock.lock()
        defer { stateLock.unlock() }
        var records = UserDefaults.standard.dictionary(forKey: idempotencyDefaultsKey) as? [String: String] ?? [:]
        records[operationId] = identifier
        UserDefaults.standard.set(records, forKey: idempotencyDefaultsKey)
    }

    private struct ParsedFieldValue {
        let value: String
        let label: String?
    }

    private struct ParsedCreateContact {
        let operationId: String
        let displayName: String
        let phoneNumbers: [ParsedFieldValue]
        let emailAddresses: [ParsedFieldValue]
        let organisation: String?
        let jobTitle: String?
    }

    private enum ContactsPayloadError: Error { case invalid }
}

private final class SingleContactPickerDelegate: NSObject, CNContactPickerDelegate {
    private let onSelect: (CNContact) -> Void
    private let onCancel: () -> Void

    init(onSelect: @escaping (CNContact) -> Void, onCancel: @escaping () -> Void) {
        self.onSelect = onSelect
        self.onCancel = onCancel
    }

    func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        onCancel()
    }

    func contactPicker(
        _ picker: CNContactPickerViewController,
        didSelect contact: CNContact
    ) {
        onSelect(contact)
    }
}
