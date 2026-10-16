package com.akwaschool.mobile;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Rappels de l'enseignant en notifications (notes à saisir avant la date limite fixée par le directeur, messages
 * non lus) : l'interface calcule la liste, ce récepteur les programme (AlarmManager, sans Internet) et les affiche.
 * Après un redémarrage du téléphone, les rappels enregistrés sont reprogrammés.
 */
public class Rappels extends BroadcastReceiver {
    private static final String CANAL = "rappels";
    private static final String PREF = "rappels";
    private static final String NOMBRE = "rappels_n";

    /** Remplace les rappels programmés par ceux de la liste JSON [{quand (ms), titre, texte}]. */
    static int programmer(Context c, String json) {
        SharedPreferences p = c.getSharedPreferences("akwa", Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        int avant = p.getInt(NOMBRE, 0);
        for (int i = 0; i < avant; i++) {
            am.cancel(intention(c, i, null, null));
        }
        int n = 0;
        try {
            JSONArray l = new JSONArray(json == null ? "[]" : json);
            long maintenant = System.currentTimeMillis();
            for (int i = 0; i < l.length() && n < 30; i++) {
                JSONObject r = l.getJSONObject(i);
                long quand = r.getLong("quand");
                if (quand <= maintenant) {
                    continue;
                }
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quand,
                        intention(c, n, r.optString("titre"), r.optString("texte")));
                n++;
            }
        } catch (JSONException e) {
            json = "[]";
        }
        p.edit().putString(PREF, json).putInt(NOMBRE, n).apply();
        return n;
    }

    private static PendingIntent intention(Context c, int n, String titre, String texte) {
        Intent i = new Intent(c, Rappels.class).setAction("com.akwaschool.mobile.RAPPEL." + n);
        if (titre != null) {
            i.putExtra("titre", titre).putExtra("texte", texte);
        }
        return PendingIntent.getBroadcast(c, n, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) {
            programmer(c, c.getSharedPreferences("akwa", Context.MODE_PRIVATE).getString(PREF, "[]"));
            return;
        }
        String titre = i.getStringExtra("titre");
        if (titre == null) {
            return;
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CANAL, "Rappels de l'enseignant",
                NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent ouvrir = PendingIntent.getActivity(c, 0, new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE);
        String texte = i.getStringExtra("texte");
        Notification n = new Notification.Builder(c, CANAL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(titre)
                .setContentText(texte)
                .setStyle(new Notification.BigTextStyle().bigText(texte))
                .setContentIntent(ouvrir)
                .setAutoCancel(true)
                .build();
        nm.notify(titre.hashCode(), n);
    }
}
