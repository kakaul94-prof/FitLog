package app.fitlog.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

/**
 * Opened when the user taps the privacy-policy link on Health Connect's permission
 * screen (and satisfies Play's Health Connect requirement). FitLog only READS the
 * daily step total to display it — steps are never stored on a server or shared.
 */
public class PermissionsRationaleActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TextView tv = new TextView(this);
        tv.setText(
            "FitLog reads your daily step count from Health Connect to show it in your "
                + "diary. Your steps are read on-device only — they are not stored on our "
                + "servers or shared with anyone.");
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        tv.setPadding(pad, pad, pad, pad);
        tv.setTextSize(16);
        tv.setGravity(Gravity.CENTER_VERTICAL);
        setContentView(tv);
    }
}
