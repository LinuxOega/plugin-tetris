package run.halo.tetris;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Sort;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.content.Post;
import run.halo.app.core.extension.content.SinglePage;
import run.halo.app.core.extension.content.Snapshot;
import run.halo.app.extension.Extension;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.ReactiveExtensionClient;

/** Unit tests for the automatic /tetris page creation contract. */
@ExtendWith(MockitoExtension.class)
class TetrisPageInitializerTest {

    private static final Duration TIMEOUT = Duration.ofSeconds(5);

    @Mock
    private ReactiveExtensionClient client;

    private TetrisPageInitializer initializer() {
        return new TetrisPageInitializer(client);
    }

    private void stubCreateEcho() {
        when(client.create(any(Snapshot.class)))
            .thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));
        when(client.create(any(SinglePage.class)))
            .thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));
    }

    private void stubSlugFree() {
        when(client.listAll(eq(SinglePage.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.empty());
    }

    @Test
    void createsPublishedPublicPageAndBaseSnapshotWhenAbsent() {
        when(client.fetch(SinglePage.class, TetrisPageInitializer.PAGE_NAME))
            .thenReturn(Mono.empty());
        stubSlugFree();
        stubCreateEcho();

        assertTrue(initializer().ensurePage().block(TIMEOUT));

        var created = ArgumentCaptor.forClass(Extension.class);
        verify(client, times(2)).create(created.capture());
        var snapshot = created.getAllValues().stream()
            .filter(Snapshot.class::isInstance).map(Snapshot.class::cast).findFirst().orElseThrow();
        var page = created.getAllValues().stream()
            .filter(SinglePage.class::isInstance).map(SinglePage.class::cast).findFirst().orElseThrow();

        // Halo 2.27 requires a base snapshot holding the full HTML, not a diff.
        assertEquals(TetrisPageInitializer.SNAPSHOT_NAME, snapshot.getMetadata().getName());
        assertEquals("true",
            snapshot.getMetadata().getAnnotations().get(Snapshot.KEEP_RAW_ANNO));
        assertEquals(TetrisPageInitializer.RAW_TYPE_HTML, snapshot.getSpec().getRawType());
        assertTrue(snapshot.getSpec().getContentPatch().contains(
            "src=\"/plugins/plugin-tetris/assets/tetris/index.html\""));
        assertEquals(snapshot.getSpec().getRawPatch(), snapshot.getSpec().getContentPatch());
        assertEquals(TetrisPageInitializer.PAGE_NAME, snapshot.getSpec().getSubjectRef().getName());
        assertEquals(SinglePage.KIND, snapshot.getSpec().getSubjectRef().getKind());

        // The page is published, public and points at that snapshot.
        var spec = page.getSpec();
        assertEquals(TetrisPageInitializer.PAGE_NAME, page.getMetadata().getName());
        assertEquals("tetris", spec.getSlug());
        assertEquals(TetrisPageInitializer.PAGE_TITLE, spec.getTitle());
        assertTrue(spec.getPublish());
        assertEquals(Post.VisibleEnum.PUBLIC, spec.getVisible());
        assertFalse(spec.getDeleted());
        assertEquals(TetrisPageInitializer.SNAPSHOT_NAME, spec.getBaseSnapshot());
        assertEquals(TetrisPageInitializer.SNAPSHOT_NAME, spec.getHeadSnapshot());
        assertEquals(TetrisPageInitializer.SNAPSHOT_NAME, spec.getReleaseSnapshot());
        assertEquals("true", page.getMetadata().getLabels().get(SinglePage.PUBLISHED_LABEL));
        assertEquals("PUBLIC", page.getMetadata().getLabels().get(SinglePage.VISIBLE_LABEL));
        assertEquals("true", page.getMetadata().getLabels()
            .get(TetrisPageInitializer.MANAGED_LABEL));
        assertNotNull(spec.getOwner());
    }

    @Test
    void existingManagedPageIsNeverOverwrittenButIsRepaired() {
        var existing = TetrisPageInitializer.buildPage();
        existing.getSpec().setPublish(false);
        existing.getSpec().setVisible(Post.VisibleEnum.PRIVATE);
        existing.getSpec().setDeleted(true);
        existing.getSpec().setSlug("renamed-by-admin");
        existing.getMetadata().getLabels().put(SinglePage.PUBLISHED_LABEL, "false");

        when(client.fetch(SinglePage.class, TetrisPageInitializer.PAGE_NAME))
            .thenReturn(Mono.just(existing));
        when(client.fetch(Snapshot.class, TetrisPageInitializer.SNAPSHOT_NAME))
            .thenReturn(Mono.just(TetrisPageInitializer.buildSnapshot("content")));
        when(client.update(any(SinglePage.class)))
            .thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));

        assertTrue(initializer().ensurePage().block(TIMEOUT));

        verify(client).update(any(SinglePage.class));
        verify(client, never()).create(any(Extension.class));
        assertEquals("tetris", existing.getSpec().getSlug());
        assertTrue(existing.getSpec().getPublish());
        assertEquals(Post.VisibleEnum.PUBLIC, existing.getSpec().getVisible());
        assertFalse(existing.getSpec().getDeleted());
        assertEquals("true",
            existing.getMetadata().getLabels().get(SinglePage.PUBLISHED_LABEL));
        // Content and title are preserved.
        assertEquals(TetrisPageInitializer.PAGE_TITLE, existing.getSpec().getTitle());
        assertEquals(TetrisPageInitializer.SNAPSHOT_NAME,
            existing.getSpec().getReleaseSnapshot());
    }

    @Test
    void healthyExistingPageIsLeftCompletelyUntouched() {
        var existing = TetrisPageInitializer.buildPage();
        when(client.fetch(SinglePage.class, TetrisPageInitializer.PAGE_NAME))
            .thenReturn(Mono.just(existing));
        when(client.fetch(Snapshot.class, TetrisPageInitializer.SNAPSHOT_NAME))
            .thenReturn(Mono.just(TetrisPageInitializer.buildSnapshot("content")));

        assertFalse(initializer().ensurePage().block(TIMEOUT));

        verify(client, never()).create(any(Extension.class));
        verify(client, never()).update(any(SinglePage.class));
    }

    @Test
    void doesNotCreateDuplicateWhenAnotherPageOwnsTheSlug() {
        var otherPage = TetrisPageInitializer.buildPage();
        otherPage.getMetadata().setName("someone-elses-page");
        when(client.fetch(SinglePage.class, TetrisPageInitializer.PAGE_NAME))
            .thenReturn(Mono.empty());
        when(client.listAll(eq(SinglePage.class), any(ListOptions.class), any(Sort.class)))
            .thenReturn(Flux.just(otherPage));

        assertFalse(initializer().ensurePage().block(TIMEOUT));

        verify(client, never()).create(any(Extension.class));
    }

    @Test
    void generatedFragmentIsSameOriginRelativeAndScriptFree() throws Exception {
        String content;
        try (InputStream in = getClass().getClassLoader()
            .getResourceAsStream("page/tetris.html")) {
            assertNotNull(in, "page/tetris.html must be packaged in the JAR");
            content = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        var body = content.replaceAll("<!--[\\s\\S]*?-->", "");
        assertFalse(body.contains("http://") || body.contains("https://"),
            "the generated page must not pin any host");
        assertFalse(body.toLowerCase().contains("<script"),
            "the generated page must work even if editors strip scripts");
        assertTrue(body.contains(
            "src=\"/plugins/plugin-tetris/assets/tetris/index.html\""));
        assertTrue(body.contains("data-tetris"));
    }

    @Test
    void upgradesLegacyPluginContentInPlace() {
        var existing = TetrisPageInitializer.buildPage();
        var legacy = TetrisPageInitializer.buildSnapshot(
            "<iframe data-tetris style='height:clamp(720px,92vh,900px)'></iframe>");
        when(client.fetch(SinglePage.class, TetrisPageInitializer.PAGE_NAME))
            .thenReturn(Mono.just(existing));
        when(client.fetch(Snapshot.class, TetrisPageInitializer.SNAPSHOT_NAME))
            .thenReturn(Mono.just(legacy));
        when(client.update(any(Snapshot.class)))
            .thenAnswer(invocation -> Mono.just(invocation.getArgument(0)));

        initializer().ensurePage().block(TIMEOUT);

        verify(client).update(any(Snapshot.class));
        assertTrue(legacy.getSpec().getRawPatch().contains(TetrisPageInitializer.FIT_MARKER));
        assertEquals(legacy.getSpec().getRawPatch(), legacy.getSpec().getContentPatch());
        verify(client, never()).update(any(SinglePage.class));
    }

    @Test
    void ownerEditedContentIsNeverReplaced() {
        var existing = TetrisPageInitializer.buildPage();
        var custom = TetrisPageInitializer.buildSnapshot("<p>站点自定义内容</p>");
        when(client.fetch(SinglePage.class, TetrisPageInitializer.PAGE_NAME))
            .thenReturn(Mono.just(existing));
        when(client.fetch(Snapshot.class, TetrisPageInitializer.SNAPSHOT_NAME))
            .thenReturn(Mono.just(custom));

        initializer().ensurePage().block(TIMEOUT);

        verify(client, never()).update(any(Extension.class));
        assertEquals("<p>站点自定义内容</p>", custom.getSpec().getRawPatch());
    }
}
