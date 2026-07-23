package app.fitlog.mobile

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Read-only Health Connect bridge: daily step totals plus weigh-in records
 * (smart-scale sync). Reads only — no writes, no background service. Each data
 * type has its own permission, checked per method, so granting one never gates
 * the other. Every method degrades gracefully when Health Connect is missing or
 * the permission hasn't been granted.
 */
@CapacitorPlugin(name = "StepCounter")
class StepCounterPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val stepsPermissions = setOf(HealthPermission.getReadPermission(StepsRecord::class))
    private val weightPermissions = setOf(HealthPermission.getReadPermission(WeightRecord::class))

    private fun available(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    private fun permissionsFor(scope: String?): Set<String> =
        if (scope == "weight") weightPermissions else stepsPermissions

    /** Total steps for the given local day ("yyyy-MM-dd"); resolves { status, steps }. */
    @PluginMethod
    fun readSteps(call: PluginCall) {
        if (!available()) {
            call.resolve(JSObject().put("status", "unavailable"))
            return
        }
        val dateStr = call.getString("date")
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                if (!client.permissionController.getGrantedPermissions().containsAll(stepsPermissions)) {
                    call.resolve(JSObject().put("status", "no_permission"))
                    return@launch
                }
                val zone = ZoneId.systemDefault()
                val day = if (dateStr != null) LocalDate.parse(dateStr) else LocalDate.now(zone)
                val start = day.atStartOfDay(zone).toInstant()
                val end = day.plusDays(1).atStartOfDay(zone).toInstant()
                val result = client.aggregate(
                    AggregateRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                    )
                )
                val steps = result[StepsRecord.COUNT_TOTAL] ?: 0L
                call.resolve(JSObject().put("status", "ok").put("steps", steps.toInt()))
            } catch (e: Exception) {
                call.reject(e.message ?: "readSteps failed")
            }
        }
    }

    /**
     * Weight records at/after the given ISO instant ("since"); resolves
     * { status, records: [{ date, kg, time, id, origin }] } where date is the
     * record's LOCAL calendar day and origin is the writing app's package name.
     */
    @PluginMethod
    fun readWeights(call: PluginCall) {
        if (!available()) {
            call.resolve(JSObject().put("status", "unavailable"))
            return
        }
        val sinceStr = call.getString("since")
        if (sinceStr == null) {
            call.reject("since is required")
            return
        }
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                if (!client.permissionController.getGrantedPermissions().containsAll(weightPermissions)) {
                    call.resolve(JSObject().put("status", "no_permission"))
                    return@launch
                }
                val zone = ZoneId.systemDefault()
                val response = client.readRecords(
                    ReadRecordsRequest(
                        recordType = WeightRecord::class,
                        timeRangeFilter = TimeRangeFilter.after(Instant.parse(sinceStr)),
                    )
                )
                val records = JSArray()
                for (r in response.records) {
                    records.put(
                        JSObject()
                            .put("date", r.time.atZone(zone).toLocalDate().toString())
                            .put("kg", r.weight.inKilograms)
                            .put("time", r.time.toString())
                            .put("id", r.metadata.id)
                            .put("origin", r.metadata.dataOrigin.packageName)
                    )
                }
                call.resolve(JSObject().put("status", "ok").put("records", records))
            } catch (e: Exception) {
                call.reject(e.message ?: "readWeights failed")
            }
        }
    }

    /**
     * Launch Health Connect's grant screen for the given scope ("steps" default,
     * or "weight"); resolves { granted }.
     */
    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (!available()) {
            call.resolve(JSObject().put("granted", false))
            return
        }
        val intent = PermissionController
            .createRequestPermissionResultContract()
            .createIntent(context, permissionsFor(call.getString("scope")))
        startActivityForResult(call, intent, "onPermissionResult")
    }

    @ActivityCallback
    fun onPermissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = PermissionController
            .createRequestPermissionResultContract()
            .parseResult(result.resultCode, result.data)
        call.resolve(
            JSObject().put("granted", granted.containsAll(permissionsFor(call.getString("scope"))))
        )
    }
}
