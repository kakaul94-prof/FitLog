package app.fitlog.mobile;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native rest-timer notification:
 *  - start(): posts an ongoing, system-ticked countdown notification (no flashing,
 *    survives backgrounding) and arms an exact alarm for the end.
 *  - cancel(): clears the notification + alarm (skip/stop/pause).
 * The alarm fires RestTimerReceiver, which shows the "done" banner, vibrates,
 * and ducks the music — natively, so it works even when the app is backgrounded.
 */
@CapacitorPlugin(name = "RestTimer")
public class RestTimerPlugin extends Plugin {

    static final String CH_RUNNING = "rest_running";
    static final String CH_DONE = "rest_done";
    static final int RUNNING_ID = 4101;
    static final int DONE_ID = 4102;
    static final int ALARM_REQ = 4103;
    static final int SMALL_ICON = android.R.drawable.ic_lock_idle_alarm;
    static final long[] VIBRATION = new long[] { 0, 250, 120, 250 };

    static void createChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel running =
                new NotificationChannel(CH_RUNNING, "Rest timer", NotificationManager.IMPORTANCE_LOW);
        running.setSound(null, null);
        running.enableVibration(false);
        running.setShowBadge(false);
        nm.createNotificationChannel(running);
        NotificationChannel done =
                new NotificationChannel(CH_DONE, "Rest finished", NotificationManager.IMPORTANCE_HIGH);
        done.setSound(null, null); // vibration only, no tone
        done.enableVibration(true);
        done.setVibrationPattern(VIBRATION);
        nm.createNotificationChannel(done);
    }

    static PendingIntent openAppIntent(Context ctx) {
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) launch = new Intent();
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, 0, launch, flags);
    }

    private PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, RestTimerReceiver.class);
        i.setAction("app.fitlog.mobile.REST_DONE");
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, ALARM_REQ, i, flags);
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        long now = System.currentTimeMillis();
        // Read endsAt robustly: a large JS integer can arrive as Long/Integer
        // (getDouble() can then return null). opt() + instanceof Number handles
        // every numeric type, and a string as a last resort.
        long endsAt = 0L;
        try {
            Object raw = call.getData() != null ? call.getData().opt("endsAt") : null;
            if (raw instanceof Number) endsAt = ((Number) raw).longValue();
            else if (raw != null) endsAt = Long.parseLong(raw.toString().trim());
        } catch (Exception e) {
            android.util.Log.e("RestTimer", "endsAt parse failed", e);
        }
        android.util.Log.d("RestTimer", "start: endsAt=" + endsAt + " now=" + now + " delta=" + (endsAt - now));
        if (endsAt <= now) {
            android.util.Log.w("RestTimer", "early return — endsAt not in the future");
            call.resolve();
            return;
        }

        ensureNotifPermission();
        createChannels(ctx);
        android.util.Log.d("RestTimer", "channels created; posting countdown notification");

        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, CH_RUNNING)
                : new Notification.Builder(ctx);
        b.setSmallIcon(SMALL_ICON)
                .setContentTitle("Rest")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setUsesChronometer(true)
                .setWhen(endsAt)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(openAppIntent(ctx));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(true);
        try {
            nm.notify(RUNNING_ID, b.build());
            android.util.Log.d("RestTimer", "notify posted OK");
        } catch (Exception e) {
            android.util.Log.e("RestTimer", "notify failed", e);
        }

        scheduleAlarm(ctx, endsAt);
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(RUNNING_ID);
        nm.cancel(DONE_ID);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmIntent(ctx));
        call.resolve();
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        ensureNotifPermission();
        call.resolve();
    }

    private void ensureNotifPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        final android.app.Activity act = getActivity();
        if (act == null) return;
        if (ContextCompat.checkSelfPermission(
                        getContext(), android.Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) return;
        // Must run on the UI thread or the system permission dialog never appears.
        act.runOnUiThread(() ->
                ActivityCompat.requestPermissions(
                        act,
                        new String[] { android.Manifest.permission.POST_NOTIFICATIONS },
                        9301));
    }

    private void scheduleAlarm(Context ctx, long endsAt) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx);
        am.cancel(pi);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, endsAt, pi);
            }
        } catch (SecurityException e) {
            am.set(AlarmManager.RTC_WAKEUP, endsAt, pi);
        }
    }
}
