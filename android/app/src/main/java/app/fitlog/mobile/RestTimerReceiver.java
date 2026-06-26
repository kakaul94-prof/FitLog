package app.fitlog.mobile;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Fired by the exact alarm when the rest timer reaches zero. Swaps the ongoing
 * countdown for a dismissible "Rest over" banner, vibrates, and briefly ducks
 * any playing music so the end is noticeable — all native, so it works even
 * when the app is backgrounded or the screen is off.
 */
public class RestTimerReceiver extends BroadcastReceiver {

    private static final AudioManager.OnAudioFocusChangeListener NOOP = focusChange -> {};
    private static final long DUCK_MS = 3000;

    @Override
    public void onReceive(Context ctx, Intent intent) {
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(RestTimerPlugin.RUNNING_ID);

        RestTimerPlugin.createChannels(ctx);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(ctx, RestTimerPlugin.CH_DONE)
                : new Notification.Builder(ctx);
        b.setSmallIcon(RestTimerPlugin.SMALL_ICON)
                .setContentTitle("Rest over")
                .setContentText("Time for your next set")
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setContentIntent(RestTimerPlugin.openAppIntent(ctx));
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setVibrate(RestTimerPlugin.VIBRATION);
        }
        nm.notify(RestTimerPlugin.DONE_ID, b.build());

        vibrate(ctx);
        duck(ctx);
    }

    private void vibrate(Context ctx) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm =
                    (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (v == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(RestTimerPlugin.VIBRATION, -1));
        } else {
            v.vibrate(RestTimerPlugin.VIBRATION, -1);
        }
    }

    /** Force the media volume down briefly, then restore it. Deterministic — unlike
     *  audio-focus "may duck", which players can ignore. goAsync() keeps the process
     *  alive long enough to run the restore. SecurityException if DND blocks it. */
    private void duck(Context ctx) {
        final AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        try {
            final int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
            final int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            final int low = Math.max(0, Math.round(max * 0.2f));
            if (cur <= low) return; // already quiet — nothing to dip
            final PendingResult pr = goAsync();
            am.setStreamVolume(AudioManager.STREAM_MUSIC, low, 0);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, cur, 0);
                } catch (Exception ignored) {
                }
                pr.finish();
            }, DUCK_MS);
        } catch (SecurityException ignored) {
            // volume changes can be blocked by DND/zen — fine to skip
        }
    }
}
