package run.halo.tetris;

/** Public projection of a leaderboard row — never exposes raw extension metadata. */
public record ScoreView(
    String player,
    int score,
    int lines,
    int level,
    int pieces,
    String createdAt
) {
}
