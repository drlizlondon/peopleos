import Foundation
import CloudKit
import Capacitor

@objc(PeopleOSCloudSyncPlugin)
public final class PeopleOSCloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PeopleOSCloudSyncPlugin"
    public let jsName = "PeopleOSCloudSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getAccountStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ensureZone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushOperations", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchChanges", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchAllRecords", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSyncHealth", returnType: CAPPluginReturnPromise)
    ]

    private let container = CKContainer(identifier: "iCloud.com.drlizlondon.peopleos")
    private let zoneID = CKRecordZone.ID(zoneName: "PeopleOSZoneV1", ownerName: CKCurrentUserDefaultName)
    private let recordType = "PeopleOSEntityV1"
    private let lock = NSLock()

    private var database: CKDatabase { container.privateCloudDatabase }

    @objc public func getAccountStatus(_ call: CAPPluginCall) {
        container.accountStatus { status, error in
            if let error = error { call.reject("Account status unavailable", nil, error, self.errorObject(error)); return }
            call.resolve(["status": self.accountStatus(status)])
        }
    }

    @objc public func getSyncHealth(_ call: CAPPluginCall) {
        container.accountStatus { status, error in
            if let error = error { call.reject("Sync health unavailable", nil, error, self.errorObject(error)); return }
            call.resolve(["available": status == .available, "accountStatus": self.accountStatus(status)])
        }
    }

    @objc public func ensureZone(_ call: CAPPluginCall) {
        let zone = CKRecordZone(zoneID: zoneID)
        let operation = CKModifyRecordZonesOperation(recordZonesToSave: [zone], recordZoneIDsToDelete: nil)
        operation.modifyRecordZonesResultBlock = { result in
            switch result {
            case .success: call.resolve()
            case .failure(let error): call.reject("Could not prepare iCloud Sync", nil, error, self.errorObject(error))
            }
        }
        database.add(operation)
    }

    @objc public func pushOperations(_ call: CAPPluginCall) {
        guard let values = call.getArray("operations") as? [[String: Any]], !values.isEmpty, values.count <= 100 else {
            call.reject("Malformed sync batch", nil, nil, ["category": "malformed_payload"]); return
        }
        do {
            let pairs = try values.map { value -> (String, CKRecord) in
                guard let operationID = value["id"] as? String, operationID.count <= 500 else { throw PayloadError.malformed }
                return (operationID, try makeRecord(value))
            }
            let byRecordName = Dictionary(uniqueKeysWithValues: pairs.map { ($0.1.recordID.recordName, $0.0) })
            var results: [[String: Any]] = []
            let operation = CKModifyRecordsOperation(recordsToSave: pairs.map(\.1), recordIDsToDelete: nil)
            operation.savePolicy = .ifServerRecordUnchanged
            operation.isAtomic = false
            operation.perRecordSaveBlock = { recordID, result in
                let operationID = byRecordName[recordID.recordName] ?? "unknown"
                self.lock.lock(); defer { self.lock.unlock() }
                switch result {
                case .success(let record):
                    results.append(["operationId": operationID, "success": true, "record": self.encode(record)])
                case .failure(let error):
                    var item: [String: Any] = ["operationId": operationID, "success": false, "errorCategory": self.category(error)]
                    if let retry = (error as? CKError)?.userInfo[CKErrorRetryAfterKey] as? NSNumber { item["retryAfterSeconds"] = retry.doubleValue }
                    if let server = (error as? CKError)?.userInfo[CKRecordChangedErrorServerRecordKey] as? CKRecord { item["record"] = self.encode(server) }
                    results.append(item)
                }
            }
            operation.modifyRecordsResultBlock = { result in
                switch result {
                case .success: call.resolve(["results": results])
                case .failure(let error):
                    if results.isEmpty { call.reject("iCloud batch failed", nil, error, self.errorObject(error)) }
                    else { call.resolve(["results": results]) }
                }
            }
            database.add(operation)
        } catch {
            call.reject("Malformed sync payload", nil, error, ["category": "malformed_payload"])
        }
    }

    @objc public func fetchChanges(_ call: CAPPluginCall) {
        do {
            let token = try decodeToken(call.getString("changeToken"))
            fetchZoneChanges(token: token, call: call)
        } catch {
            call.reject("Malformed change token", nil, error, ["category": "malformed_payload"])
        }
    }

    @objc public func fetchAllRecords(_ call: CAPPluginCall) {
        let query = CKQuery(recordType: recordType, predicate: NSPredicate(value: true))
        fetchQueryPage(CKQueryOperation(query: query), records: [], call: call)
    }

    private func fetchQueryPage(_ operation: CKQueryOperation, records initial: [[String: Any]], call: CAPPluginCall) {
        var records = initial
        operation.zoneID = zoneID
        operation.resultsLimit = 200
        operation.recordMatchedBlock = { _, result in
            if case .success(let record) = result { self.lock.lock(); records.append(self.encode(record)); self.lock.unlock() }
        }
        operation.queryResultBlock = { result in
            switch result {
            case .success(let cursor):
                if let cursor = cursor { self.fetchQueryPage(CKQueryOperation(cursor: cursor), records: records, call: call) }
                else { call.resolve(["records": records]) }
            case .failure(let error): call.reject("Could not read iCloud data", nil, error, self.errorObject(error))
            }
        }
        database.add(operation)
    }

    private func fetchZoneChanges(token: CKServerChangeToken?, call: CAPPluginCall) {
        let configuration = CKFetchRecordZoneChangesOperation.ZoneConfiguration()
        configuration.previousServerChangeToken = token
        configuration.resultsLimit = 200
        let operation = CKFetchRecordZoneChangesOperation(recordZoneIDs: [zoneID], configurationsByRecordZoneID: [zoneID: configuration])
        var records: [[String: Any]] = []
        var deleted: [String] = []
        var nextToken: CKServerChangeToken?
        var moreComing = false
        operation.recordWasChangedBlock = { _, result in
            if case .success(let record) = result { self.lock.lock(); records.append(self.encode(record)); self.lock.unlock() }
        }
        operation.recordWithIDWasDeletedBlock = { recordID, _ in self.lock.lock(); deleted.append(recordID.recordName); self.lock.unlock() }
        operation.recordZoneChangeTokensUpdatedBlock = { _, token, _ in nextToken = token }
        operation.recordZoneFetchResultBlock = { _, result in
            if case .success(let value) = result { nextToken = value.serverChangeToken; moreComing = value.moreComing }
        }
        operation.fetchRecordZoneChangesResultBlock = { result in
            switch result {
            case .success:
                var response: [String: Any] = ["records": records, "deletedRecordNames": deleted, "moreComing": moreComing]
                if let token = nextToken, let encoded = try? self.encodeToken(token) { response["changeToken"] = encoded }
                call.resolve(response)
            case .failure(let error):
                if (error as? CKError)?.code == .changeTokenExpired {
                    call.resolve(["records": [], "deletedRecordNames": [], "moreComing": false, "tokenExpired": true])
                } else { call.reject("Could not fetch iCloud changes", nil, error, self.errorObject(error)) }
            }
        }
        database.add(operation)
    }

    private func makeRecord(_ value: [String: Any]) throws -> CKRecord {
        guard let recordName = value["cloudRecordName"] as? String, recordName.count <= 255,
              let store = value["store"] as? String, allowedStores.contains(store),
              let entityID = value["entityId"] as? String, entityID.count <= 500,
              let schemaVersion = value["schemaVersion"] as? NSNumber,
              let revision = value["revision"] as? NSNumber,
              let updatedAt = value["updatedAt"] as? String, ISO8601DateFormatter().date(from: updatedAt) != nil,
              let origin = value["originDeviceId"] as? String, origin.count <= 200 else { throw PayloadError.malformed }
        let record: CKRecord
        if let system = value["systemFields"] as? String, let data = Data(base64Encoded: system),
           let decoded = try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKRecord.self, from: data) { record = decoded }
        else { record = CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: recordName, zoneID: zoneID)) }
        let deleted = (value["kind"] as? String) == "delete"
        record["store"] = store as CKRecordValue
        record["entityId"] = entityID as CKRecordValue
        record["schemaVersion"] = schemaVersion
        record["revision"] = revision
        record["updatedAt"] = updatedAt as CKRecordValue
        record["deleted"] = NSNumber(value: deleted)
        record["originDeviceId"] = origin as CKRecordValue
        if deleted {
            guard let deletedAt = value["deletedAt"] as? String else { throw PayloadError.malformed }
            record["deletedAt"] = deletedAt as CKRecordValue; record["payload"] = nil
        } else {
            guard let payload = value["payload"], JSONSerialization.isValidJSONObject(payload) else { throw PayloadError.malformed }
            let data = try JSONSerialization.data(withJSONObject: payload)
            guard data.count <= 900_000 else { throw PayloadError.malformed }
            record["payload"] = data as CKRecordValue; record["deletedAt"] = nil
        }
        return record
    }

    private func encode(_ record: CKRecord) -> [String: Any] {
        var result: [String: Any] = [
            "store": record["store"] as? String ?? "", "entityId": record["entityId"] as? String ?? "",
            "recordName": record.recordID.recordName, "schemaVersion": record["schemaVersion"] as? NSNumber ?? 0,
            "revision": record["revision"] as? NSNumber ?? 0, "updatedAt": record["updatedAt"] as? String ?? "",
            "deleted": (record["deleted"] as? NSNumber)?.boolValue ?? false,
            "originDeviceId": record["originDeviceId"] as? String ?? "", "changeTag": record.recordChangeTag ?? ""
        ]
        if let deletedAt = record["deletedAt"] as? String { result["deletedAt"] = deletedAt }
        if let data = record["payload"] as? Data, let payload = try? JSONSerialization.jsonObject(with: data) { result["payload"] = payload }
        if let fields = try? NSKeyedArchiver.archivedData(withRootObject: record, requiringSecureCoding: true) { result["systemFields"] = fields.base64EncodedString() }
        return result
    }

    private func accountStatus(_ status: CKAccountStatus) -> String {
        switch status { case .available: return "available"; case .noAccount: return "no_account"; case .restricted: return "restricted"; case .temporarilyUnavailable: return "temporarily_unavailable"; default: return "unknown" }
    }

    private func category(_ error: Error) -> String {
        guard let value = error as? CKError else { return "unknown" }
        switch value.code {
        case .notAuthenticated: return "authentication_changed"
        case .networkFailure, .networkUnavailable: return "network_unavailable"
        case .quotaExceeded: return "quota_exceeded"
        case .partialFailure: return "partial_failure"
        case .requestRateLimited, .serviceUnavailable, .zoneBusy: return "rate_limited"
        case .serverRecordChanged: return "record_conflict"
        case .changeTokenExpired: return "change_token_expired"
        case .badDatabase, .badContainer, .invalidArguments, .permissionFailure, .serverRejectedRequest: return "server_rejected"
        default: return "unknown"
        }
    }

    private func errorObject(_ error: Error) -> [String: Any] {
        var result: [String: Any] = ["category": category(error)]
        if let retry = (error as? CKError)?.userInfo[CKErrorRetryAfterKey] as? NSNumber { result["retryAfterSeconds"] = retry.doubleValue }
        return result
    }

    private func encodeToken(_ token: CKServerChangeToken) throws -> String {
        try NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true).base64EncodedString()
    }

    private func decodeToken(_ encoded: String?) throws -> CKServerChangeToken? {
        guard let encoded else { return nil }
        guard let data = Data(base64Encoded: encoded) else { throw PayloadError.malformed }
        return try NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
    }

    private let allowedStores: Set<String> = ["people", "contactMethods", "externalIdentities", "affiliations", "interactions", "events", "memoryFacts", "followUps", "followUpEvents", "todaySkips", "reachOutEntries", "reachOutEvents", "reachOutContexts", "appSettings"]
    private enum PayloadError: Error { case malformed }
}
