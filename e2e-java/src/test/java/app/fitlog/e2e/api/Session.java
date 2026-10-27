package app.fitlog.e2e.api;

/** A signed-in user's identity and access token, as the Auth API returned them. */
public record Session(String userId, String email, String accessToken) {}
