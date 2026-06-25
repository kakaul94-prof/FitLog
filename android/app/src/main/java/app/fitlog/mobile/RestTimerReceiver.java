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

    /** Request transient "may duck" audio focus, hold briefly, then release so the
     *  music restores. If the process dies first, focus auto-releases anyway. */
    private void duck(Context ctx) {
        final AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        final PendingResult pr = goAsync();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            final AudioFocusRequest req =
                    new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                            .setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build())
                            .build();
            am.requestAudioFocus(req);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                am.abandonAudioFocusRequest(req);
                pr.finish();
            }, DUCK_MS);
        } else {
            am.requestAudioFocus(NOOP, AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                am.abandonAudioFocus(NOOP);
                pr.finish();
            }, DUCK_MS);
        }
    }
}
