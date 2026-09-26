// SPDX-License-Identifier: Apache-2.0
package com.sasonica.next.speech;

import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The phone's readouts for agent-media's readers on the phone, on loopback
 * {@link #PORT}: call_guard's {@code /mic}, ringer.py's {@code /ringer}, and
 * {@code /state} for {@code media doctor} (the dictation hold rate) and the
 * route's "is the app here" check.
 *
 * <p>The old Sasonica app answered these on its book player's port, 8772. That
 * app stays for books, so the port stays its own, and Next takes the readouts
 * over on a port of its own: the lines are the same, only the port moved.
 *
 * <p>Loopback only and no token, as before: Termux on the same phone is the
 * only caller, and nothing here changes anything.
 */
final class Readouts {
    private static final String TAG = "SasonicaReadouts";
    static final int PORT = 8774;

    /** Where the answers come from — {@link Holds} in the app, a stub in the test. */
    interface Source {
        String mic();
        String ringer();
        String holds();
        int dictationHolds1h();
        String dictationRate();
    }

    private final int port;
    private final Source source;
    private volatile ServerSocket server;
    private Thread thread;

    Readouts(int port, Source source) {
        this.port = port;
        this.source = source;
    }

    /** The source the app uses: the holds' own readings. */
    static Source holds() {
        return new Source() {
            @Override public String mic() { return Holds.micLine(); }
            @Override public String ringer() { return Holds.ringerLine(); }
            @Override public String holds() { return Holds.why(); }
            @Override public int dictationHolds1h() { return Holds.dictationHolds1h(); }
            @Override public String dictationRate() { return Holds.dictationRateProblem(); }
        };
    }

    int boundPort() {
        ServerSocket s = server;
        return (s == null || s.isClosed()) ? -1 : s.getLocalPort();
    }

    /** Bind now, so a taken port is the caller's exception rather than a silent thread. */
    synchronized void start() throws IOException {
        if (server != null) return;
        ServerSocket s = new ServerSocket(port, 4, InetAddress.getByName("127.0.0.1"));
        server = s;
        thread = new Thread(() -> loop(s), "readouts");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void stop() {
        ServerSocket s = server;
        server = null;
        if (s != null) {
            try { s.close(); } catch (IOException ignored) { }
        }
        thread = null;
    }

    private void loop(ServerSocket s) {
        while (!s.isClosed()) {
            try (Socket c = s.accept()) {
                c.setSoTimeout(5000);
                handle(c);
            } catch (IOException e) {
                if (!s.isClosed()) Log.w(TAG, "request: " + e);
            } catch (Throwable t) {
                Log.w(TAG, "request: " + t);
            }
        }
    }

    private void handle(Socket c) throws IOException {
        BufferedReader in = new BufferedReader(
                new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
        String request = in.readLine();
        if (request == null) return;
        String line;
        while ((line = in.readLine()) != null && !line.isEmpty()) { /* headers */ }
        String[] parts = request.split(" ");
        String target = parts.length > 1 ? parts[1] : "/";
        int q = target.indexOf('?');
        String path = q < 0 ? target : target.substring(0, q);

        int status = 200;
        String type = "text/plain; charset=utf-8";
        String body;
        switch (path) {
            case "/mic": body = source.mic() + "\n"; break;
            case "/ringer": body = source.ringer() + "\n"; break;
            case "/":
            case "/state":
                type = "application/json";
                body = state();
                break;
            default:
                status = 404;
                body = "not found\n";
        }
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        OutputStream out = c.getOutputStream();
        out.write(("HTTP/1.0 " + status + (status == 200 ? " OK" : " Not Found")
                + "\r\nContent-Type: " + type
                + "\r\nContent-Length: " + bytes.length
                + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    /** The keys the old app's {@code /state} carried for these readers, and no player. */
    private String state() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("app", "next");
        m.put("holds", source.holds());
        m.put("dictation_holds_1h", source.dictationHolds1h());
        String rate = source.dictationRate();
        if (rate != null && !rate.isEmpty()) m.put("dictation_rate", rate);
        return Json.write(m);
    }
}
