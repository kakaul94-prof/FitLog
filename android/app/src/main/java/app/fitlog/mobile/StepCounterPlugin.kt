package app.fitlog.mobile

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
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
import java.time.LocalDate
import java.time.ZoneId

/**
 * Read-only Health Connect bridge: returns the phone's passively-recorded daily
 * step total so the Diary can display it. Reads only — no writes, no background
 * service, only the READ_STEPS permission. Every method degrades gracefully when
 * Health Connect is missing or the permission hasn't been granted.
 */
@CapacitorPlugin(name = "StepCounter")
class StepCounterPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val permissions = setOf(HealthPermission.getReadPermission(StepsRecord::class))

    private fun available(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

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
                if (!client.permissionController.getGrantedPermissions().containsAll(permissions)) {
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

    /** Launch Health Connect's own grant screen for READ_STEPS; resolves { granted }. */
    @PluginMethod
    override fun requestPermissions(call: PluginCall) {
        if (!available()) {
            call.resolve(JSObject().put("granted", false))
            return
        }
        val intent = PermissionController
            .createRequestPermissionResultContract()
            .createIntent(context, permissions)
        startActivityForResult(call, intent, "onPermissionResult")
    }

    @ActivityCallback
    fun onPermissionResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val granted = PermissionController
            .createRequestPermissionResultContract()
            .parseResult(result.resultCode, result.data)
        call.resolve(JSObject().put("granted", granted.containsAll(permissions)))
    }
}
