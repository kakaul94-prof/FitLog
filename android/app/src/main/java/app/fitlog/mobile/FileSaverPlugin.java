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

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Save-As via the Storage Access Framework. saveAs() opens the system
 * ACTION_CREATE_DOCUMENT dialog so the user picks the folder + filename, then
 * writes the text into the chosen URI. SAF grants per-URI access, so no storage
 * permission is needed. Backing out of the dialog rejects with "cancelled" so
 * the JS side can treat it as a no-op rather than an error.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveAs(PluginCall call) {
        String filename = call.getString("filename", "export.txt");
        String mimeType = call.getString("mimeType", "application/octet-stream");
        if (call.getString("data") == null) {
            call.reject("No data to save.");
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
        final Uri uri = data != null ? data.getData() : null;
        if (uri == null) {
            call.reject("No location was chosen.");
            return;
        }
        // The saved call keeps its original arguments, so the payload is still here.
        final String content = call.getString("data", "");
        // Write off the main thread: a large export (or a slow/remote SAF target
        // such as Drive) would otherwise block the UI thread long enough that
        // Android shows "FitLog isn't responding" (ANR). resolve/reject are
        // safe to call from a worker thread.
        new Thread(() -> {
            try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                if (os == null) {
                    call.reject("Could not open the chosen location.");
                    return;
                }
                os.write(content.getBytes(StandardCharsets.UTF_8));
                os.flush();
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Save failed: " + e.getMessage());
            }
        }).start();
    }
}
