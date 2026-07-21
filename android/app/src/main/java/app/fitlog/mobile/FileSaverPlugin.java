package app.fitlog.mobile;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;

/**
 * Save-As via the Storage Access Framework. saveAs() opens the system
 * ACTION_CREATE_DOCUMENT dialog so the user picks the folder + filename, then
 * the chosen location is written by streaming from a staged temp file
 * (sourceUri) — the payload never crosses the bridge or sits in native memory,
 * which avoids OOM on large exports. SAF grants per-URI access, so no storage
 * permission is needed. Backing out of the dialog rejects with "cancelled" so
 * the JS side can treat it as a no-op rather than an error.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveAs(PluginCall call) {
        String filename = call.getString("filename", "export.txt");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (call.getString("sourceUri") == null) {
            call.reject("No source file to save.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("cancelled");
            return;
        }
        Intent data = result.getData();
        final Uri dest = data != null ? data.getData() : null;
        if (dest == null) {
            call.reject("No location was chosen.");
            return;
        }
        final String sourceUri = call.getString("sourceUri", "");
        // Copy off the main thread (large export / slow SAF target would ANR),
        // streaming in chunks so memory stays flat. catch Throwable so even an
        // OutOfMemoryError rejects the call instead of crashing the app.
        new Thread(() -> {
            try (
                InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(sourceUri));
                OutputStream out = getContext().getContentResolver().openOutputStream(dest)
            ) {
                if (in == null || out == null) {
                    call.reject("Could not open the file.");
                    return;
                }
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                out.flush();
                JSObject ret = new JSObject();
                ret.put("uri", dest.toString());
                call.resolve(ret);
            } catch (Throwable t) {
                call.reject("Save failed: " + t.getMessage());
            }
        }).start();
    }
}
