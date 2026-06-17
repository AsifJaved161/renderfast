<?php
/**
 * Plugin Name:       RenderFast — Prerender for SEO & AI
 * Plugin URI:        https://renderfast.vercel.app
 * Description:        Serves search engines and AI crawlers fully-rendered HTML through RenderFast, so JavaScript-heavy WordPress sites get indexed perfectly. Real visitors are untouched.
 * Version:           1.0.0
 * Author:            RenderFast
 * Author URI:        https://renderfast.vercel.app
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       renderfast
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'RENDERFAST_VERSION', '1.0.0' );
define( 'RENDERFAST_APP_URL', 'https://renderfast.vercel.app' );

// Search engines, AI crawlers and social unfurlers.
define(
	'RENDERFAST_BOT_RE',
	'/bot|crawl|spider|googlebot|bingbot|duckduckbot|yandex|baidu|sogou|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic|perplexitybot|amazonbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|pinterest/i'
);
define( 'RENDERFAST_STATIC_RE', '/\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|json|xml|txt|pdf|mp4|webm|zip|gz)$/i' );

/* ──────────────────────────────────────────────────────────────────────────
 * Options
 * ────────────────────────────────────────────────────────────────────────── */
function renderfast_opts() {
	return wp_parse_args(
		get_option( 'renderfast_options', array() ),
		array(
			'api_key' => '',
			'email'   => '',
			'plan'    => '',
			'enabled' => 1,
		)
	);
}

function renderfast_save_opts( $opts ) {
	update_option( 'renderfast_options', $opts );
}

function renderfast_site_host() {
	return strtolower( (string) wp_parse_url( home_url(), PHP_URL_HOST ) );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Prerender — serve crawlers cached/rendered HTML from RenderFast
 * ────────────────────────────────────────────────────────────────────────── */
add_action( 'template_redirect', 'renderfast_maybe_prerender', 0 );

function renderfast_maybe_prerender() {
	if ( is_admin() || is_user_logged_in() ) {
		return; // editors always see the live site
	}

	$opts = renderfast_opts();
	if ( empty( $opts['enabled'] ) || empty( $opts['api_key'] ) ) {
		return;
	}

	$method = isset( $_SERVER['REQUEST_METHOD'] ) ? $_SERVER['REQUEST_METHOD'] : 'GET';
	if ( 'GET' !== $method ) {
		return;
	}

	$ua = isset( $_SERVER['HTTP_USER_AGENT'] ) ? wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) : '';
	if ( '' === $ua || ! preg_match( RENDERFAST_BOT_RE, $ua ) ) {
		return;
	}

	// Don't loop if RenderFast's own renderer is the caller.
	if ( isset( $_SERVER['HTTP_X_PRERENDERED'] ) ) {
		return;
	}

	$uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
	if ( preg_match( RENDERFAST_STATIC_RE, $uri ) ) {
		return;
	}

	$host   = isset( $_SERVER['HTTP_HOST'] ) ? wp_unslash( $_SERVER['HTTP_HOST'] ) : renderfast_site_host();
	$scheme = is_ssl() ? 'https' : 'http';
	$target = $scheme . '://' . $host . $uri;

	$resp = wp_remote_get(
		RENDERFAST_APP_URL . '/api/proxy?url=' . rawurlencode( $target ),
		array(
			'timeout'     => 20,
			'redirection' => 0,
			'headers'     => array(
				'User-Agent'        => $ua,
				'X-Prerender-Token' => $opts['api_key'],
				'Accept'            => 'text/html',
			),
		)
	);

	if ( is_wp_error( $resp ) || 200 !== (int) wp_remote_retrieve_response_code( $resp ) ) {
		return; // fall through to normal WordPress output
	}

	$ctype = (string) wp_remote_retrieve_header( $resp, 'content-type' );
	if ( false === strpos( $ctype, 'text/html' ) ) {
		return;
	}

	$body = wp_remote_retrieve_body( $resp );
	if ( '' === $body ) {
		return;
	}

	status_header( 200 );
	header( 'Content-Type: text/html; charset=UTF-8' );
	header( 'X-Prerendered: RenderFast' );
	echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- already-rendered HTML
	exit;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Remote helpers
 * ────────────────────────────────────────────────────────────────────────── */
function renderfast_connect_site( $api_key ) {
	return wp_remote_post(
		RENDERFAST_APP_URL . '/api/plugin/connect',
		array(
			'timeout' => 20,
			'headers' => array(
				'Content-Type' => 'application/json',
				'x-api-key'    => $api_key,
			),
			'body'    => wp_json_encode(
				array(
					'domain' => renderfast_site_host(),
					'name'   => get_bloginfo( 'name' ),
				)
			),
		)
	);
}

function renderfast_fetch_status( $api_key ) {
	$resp = wp_remote_get(
		RENDERFAST_APP_URL . '/api/plugin/status?domain=' . rawurlencode( renderfast_site_host() ),
		array(
			'timeout' => 15,
			'headers' => array( 'x-api-key' => $api_key ),
		)
	);
	if ( is_wp_error( $resp ) || 200 !== (int) wp_remote_retrieve_response_code( $resp ) ) {
		return null;
	}
	return json_decode( wp_remote_retrieve_body( $resp ), true );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Admin menu + assets
 * ────────────────────────────────────────────────────────────────────────── */
add_action(
	'admin_menu',
	function () {
		add_menu_page(
			'RenderFast',
			'RenderFast',
			'manage_options',
			'renderfast',
			'renderfast_admin_page',
			'dashicons-superhero-alt',
			80
		);
	}
);

add_action(
	'admin_enqueue_scripts',
	function ( $hook ) {
		if ( 'toplevel_page_renderfast' !== $hook ) {
			return;
		}
		wp_enqueue_style( 'renderfast-admin', plugins_url( 'assets/admin.css', __FILE__ ), array(), RENDERFAST_VERSION );
	}
);

/* ──────────────────────────────────────────────────────────────────────────
 * AJAX handlers
 * ────────────────────────────────────────────────────────────────────────── */
add_action(
	'wp_ajax_renderfast_login',
	function () {
		check_ajax_referer( 'renderfast_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error( array( 'message' => 'Forbidden' ) );
		}

		$email    = isset( $_POST['email'] ) ? sanitize_email( wp_unslash( $_POST['email'] ) ) : '';
		$password = isset( $_POST['password'] ) ? (string) wp_unslash( $_POST['password'] ) : '';

		$resp = wp_remote_post(
			RENDERFAST_APP_URL . '/api/plugin/login',
			array(
				'timeout' => 20,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode( array( 'email' => $email, 'password' => $password ) ),
			)
		);

		if ( is_wp_error( $resp ) ) {
			wp_send_json_error( array( 'message' => $resp->get_error_message() ) );
		}

		$data = json_decode( wp_remote_retrieve_body( $resp ), true );
		if ( 200 !== (int) wp_remote_retrieve_response_code( $resp ) || empty( $data['api_key'] ) ) {
			wp_send_json_error( array( 'message' => isset( $data['error'] ) ? $data['error'] : 'Login failed' ) );
		}

		$opts            = renderfast_opts();
		$opts['api_key'] = $data['api_key'];
		$opts['email']   = isset( $data['email'] ) ? $data['email'] : $email;
		$opts['plan']    = isset( $data['plan'] ) ? $data['plan'] : '';
		$opts['enabled'] = 1;
		renderfast_save_opts( $opts );

		renderfast_connect_site( $opts['api_key'] );

		wp_send_json_success( array( 'message' => 'Connected' ) );
	}
);

add_action(
	'wp_ajax_renderfast_disconnect',
	function () {
		check_ajax_referer( 'renderfast_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error();
		}
		$opts            = renderfast_opts();
		$opts['api_key'] = '';
		$opts['email']   = '';
		$opts['plan']    = '';
		renderfast_save_opts( $opts );
		wp_send_json_success();
	}
);

add_action(
	'wp_ajax_renderfast_toggle',
	function () {
		check_ajax_referer( 'renderfast_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error();
		}
		$opts            = renderfast_opts();
		$opts['enabled'] = ( isset( $_POST['enabled'] ) && '1' === $_POST['enabled'] ) ? 1 : 0;
		renderfast_save_opts( $opts );
		wp_send_json_success( array( 'enabled' => $opts['enabled'] ) );
	}
);

add_action(
	'wp_ajax_renderfast_test',
	function () {
		check_ajax_referer( 'renderfast_nonce', 'nonce' );
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_send_json_error();
		}
		$opts = renderfast_opts();
		if ( empty( $opts['api_key'] ) ) {
			wp_send_json_error( array( 'message' => 'Connect your account first.' ) );
		}

		$resp = wp_remote_get(
			RENDERFAST_APP_URL . '/api/proxy?url=' . rawurlencode( home_url( '/' ) ),
			array(
				'timeout'     => 25,
				'redirection' => 0,
				'headers'     => array(
					'User-Agent'        => 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
					'X-Prerender-Token' => $opts['api_key'],
				),
			)
		);

		if ( is_wp_error( $resp ) ) {
			wp_send_json_error( array( 'message' => $resp->get_error_message() ) );
		}

		$code  = (int) wp_remote_retrieve_response_code( $resp );
		$cache = (string) wp_remote_retrieve_header( $resp, 'x-cache-status' );

		if ( 200 === $code ) {
			wp_send_json_success( array( 'message' => 'Working — crawlers receive prerendered HTML. Cache: ' . ( $cache ? $cache : 'OK' ) ) );
		}
		wp_send_json_error( array( 'message' => 'Server responded with ' . $code . '. Make sure this domain is added in your RenderFast account.' ) );
	}
);

/* ──────────────────────────────────────────────────────────────────────────
 * Admin page
 * ────────────────────────────────────────────────────────────────────────── */
function renderfast_admin_page() {
	$opts      = renderfast_opts();
	$connected = ! empty( $opts['api_key'] );
	$nonce     = wp_create_nonce( 'renderfast_nonce' );
	$signup    = RENDERFAST_APP_URL . '/signup';
	$status    = $connected ? renderfast_fetch_status( $opts['api_key'] ) : null;

	$plan        = $status['user']['plan'] ?? ( $opts['plan'] ?: 'free' );
	$used        = (int) ( $status['user']['render_count'] ?? 0 );
	$render_lim  = (int) ( $status['user']['render_limit'] ?? 0 );
	$site_render = (int) ( $status['site']['render_count'] ?? 0 );
	$site_status = $status['site']['status'] ?? null;
	$pct         = $render_lim > 0 ? min( 100, round( $used / $render_lim * 100 ) ) : 0;
	?>
	<div class="wrap rf-wrap">
		<div class="rf-header">
			<span class="rf-logo">⚡ Render<span>Fast</span></span>
			<span class="rf-ver">v<?php echo esc_html( RENDERFAST_VERSION ); ?></span>
		</div>

		<?php if ( ! $connected ) : ?>
			<!-- ── Login / Sign up ── -->
			<div class="rf-grid">
				<div class="rf-card">
					<h2>Log in</h2>
					<p class="rf-muted">Connect this site to your RenderFast account.</p>
					<div class="rf-field">
						<label>Email</label>
						<input type="email" id="rf-email" placeholder="you@example.com" autocomplete="username" />
					</div>
					<div class="rf-field">
						<label>Password</label>
						<input type="password" id="rf-password" placeholder="••••••••" autocomplete="current-password" />
					</div>
					<button class="rf-btn rf-btn-primary" id="rf-login-btn">Log in &amp; connect</button>
					<div class="rf-msg" id="rf-login-msg"></div>
				</div>

				<div class="rf-card rf-card-signup">
					<h2>New here?</h2>
					<p class="rf-muted">Create a free RenderFast account on our website, then come back and log in.</p>
					<a class="rf-btn rf-btn-ghost" href="<?php echo esc_url( $signup ); ?>" target="_blank" rel="noopener">
						Sign up on RenderFast ↗
					</a>
					<p class="rf-fineprint">After signing up, return to this page and log in with the same email &amp; password.</p>
				</div>
			</div>
		<?php else : ?>
			<!-- ── Connected dashboard ── -->
			<div class="rf-statusbar">
				<div>
					<span class="rf-dot <?php echo $opts['enabled'] ? 'on' : 'off'; ?>"></span>
					<strong><?php echo $opts['enabled'] ? 'Prerendering is ON' : 'Prerendering is OFF'; ?></strong>
					<span class="rf-muted"> · <?php echo esc_html( $opts['email'] ); ?></span>
				</div>
				<label class="rf-switch">
					<input type="checkbox" id="rf-toggle" <?php checked( $opts['enabled'], 1 ); ?> />
					<span class="rf-slider"></span>
				</label>
			</div>

			<div class="rf-grid rf-stats">
				<div class="rf-card rf-stat">
					<div class="rf-stat-label">Plan</div>
					<div class="rf-stat-value" style="text-transform:capitalize"><?php echo esc_html( $plan ); ?></div>
				</div>
				<div class="rf-card rf-stat">
					<div class="rf-stat-label">Renders this month</div>
					<div class="rf-stat-value"><?php echo esc_html( number_format( $used ) ); ?><span class="rf-muted">/<?php echo esc_html( $render_lim ? number_format( $render_lim ) : '∞' ); ?></span></div>
					<div class="rf-bar"><span style="width:<?php echo esc_attr( $pct ); ?>%"></span></div>
				</div>
				<div class="rf-card rf-stat">
					<div class="rf-stat-label">This site’s renders</div>
					<div class="rf-stat-value"><?php echo esc_html( number_format( $site_render ) ); ?></div>
					<div class="rf-muted"><?php echo esc_html( renderfast_site_host() ); ?><?php echo $site_status ? ' · ' . esc_html( $site_status ) : ''; ?></div>
				</div>
			</div>

			<?php if ( null === $status ) : ?>
				<div class="rf-notice rf-notice-warn">Couldn’t reach RenderFast just now. Stats may be out of date.</div>
			<?php elseif ( empty( $status['site'] ) ) : ?>
				<div class="rf-notice rf-notice-warn">This domain isn’t registered yet — click “Re-sync” to add it to your account.</div>
			<?php endif; ?>

			<div class="rf-actions">
				<button class="rf-btn rf-btn-primary" id="rf-test-btn">Test prerendering</button>
				<button class="rf-btn rf-btn-ghost" id="rf-sync-btn">Re-sync domain</button>
				<a class="rf-btn rf-btn-ghost" href="<?php echo esc_url( RENDERFAST_APP_URL ); ?>" target="_blank" rel="noopener">Open dashboard ↗</a>
				<button class="rf-btn rf-btn-danger" id="rf-disconnect-btn">Disconnect</button>
			</div>
			<div class="rf-msg" id="rf-action-msg"></div>
		<?php endif; ?>
	</div>

	<script>
	( function () {
		var ajaxurl = <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>;
		var nonce   = <?php echo wp_json_encode( $nonce ); ?>;

		function post( action, body ) {
			var data = new URLSearchParams();
			data.append( 'action', action );
			data.append( 'nonce', nonce );
			Object.keys( body || {} ).forEach( function ( k ) { data.append( k, body[ k ] ); } );
			return fetch( ajaxurl, { method: 'POST', credentials: 'same-origin', body: data } ).then( function ( r ) { return r.json(); } );
		}
		function msg( el, text, ok ) {
			var n = document.getElementById( el );
			if ( ! n ) { return; }
			n.textContent = text;
			n.className = 'rf-msg ' + ( ok ? 'ok' : 'err' );
		}

		var loginBtn = document.getElementById( 'rf-login-btn' );
		if ( loginBtn ) {
			loginBtn.addEventListener( 'click', function () {
				var email = document.getElementById( 'rf-email' ).value.trim();
				var pass  = document.getElementById( 'rf-password' ).value;
				if ( ! email || ! pass ) { msg( 'rf-login-msg', 'Enter your email and password.', false ); return; }
				loginBtn.disabled = true; loginBtn.textContent = 'Connecting…';
				post( 'renderfast_login', { email: email, password: pass } ).then( function ( res ) {
					if ( res && res.success ) { location.reload(); }
					else { msg( 'rf-login-msg', ( res && res.data && res.data.message ) || 'Login failed.', false ); loginBtn.disabled = false; loginBtn.textContent = 'Log in & connect'; }
				} ).catch( function () { msg( 'rf-login-msg', 'Network error.', false ); loginBtn.disabled = false; loginBtn.textContent = 'Log in & connect'; } );
			} );
		}

		var toggle = document.getElementById( 'rf-toggle' );
		if ( toggle ) {
			toggle.addEventListener( 'change', function () {
				post( 'renderfast_toggle', { enabled: toggle.checked ? '1' : '0' } ).then( function () { location.reload(); } );
			} );
		}

		var testBtn = document.getElementById( 'rf-test-btn' );
		if ( testBtn ) {
			testBtn.addEventListener( 'click', function () {
				testBtn.disabled = true; msg( 'rf-action-msg', 'Testing…', true );
				post( 'renderfast_test', {} ).then( function ( res ) {
					if ( res && res.success ) { msg( 'rf-action-msg', res.data.message, true ); }
					else { msg( 'rf-action-msg', ( res && res.data && res.data.message ) || 'Test failed.', false ); }
					testBtn.disabled = false;
				} );
			} );
		}

		var syncBtn = document.getElementById( 'rf-sync-btn' );
		if ( syncBtn ) {
			syncBtn.addEventListener( 'click', function () {
				syncBtn.disabled = true; msg( 'rf-action-msg', 'Syncing…', true );
				post( 'renderfast_login', { email: '', password: '' } ); // no-op safety
				post( 'renderfast_test', {} ).then( function () { location.reload(); } );
			} );
		}

		var disc = document.getElementById( 'rf-disconnect-btn' );
		if ( disc ) {
			disc.addEventListener( 'click', function () {
				if ( ! confirm( 'Disconnect this site from RenderFast?' ) ) { return; }
				post( 'renderfast_disconnect', {} ).then( function () { location.reload(); } );
			} );
		}
	} )();
	</script>
	<?php
}
