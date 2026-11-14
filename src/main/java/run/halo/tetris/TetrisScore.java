package run.halo.tetris;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

/** Stored leaderboard entry. Halo generates CRUD APIs for this extension. */
@Data
@EqualsAndHashCode(callSuper = true)
@GVK(
    group = "tetris.halo.run",
    version = "v1alpha1",
    kind = "TetrisScore",
    plural = "tetrisscores",
    singular = "tetrisscore"
)
public class TetrisScore extends AbstractExtension {

    @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    private Spec spec;

    @Data
    @Schema(name = "TetrisScoreSpec")
    public static class Spec {

        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minLength = 1, maxLength = 24)
        private String player;

        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "0", maximum = "10000000")
        private Integer score;

        @Schema(minimum = "0", maximum = "1000000")
        private Integer lines;

        @Schema(minimum = "1", maximum = "20")
        private Integer level;

        @Schema(minimum = "0", maximum = "1000000")
        private Integer pieces;
    }
}
