package run.halo.tetris;

/** Payload of POST /scores. Validation happens explicitly in ScoreService. */
public record ScoreSubmit(
    String player,
    Integer score,
    Integer lines,
    Integer level,
    Integer pieces
) {
}
