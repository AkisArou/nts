// The release shell an app runs in (`nts_app_shell`): a content embedder of
// its own, with nothing of the test-only content_shell -- the way an
// Electron-like runtime embeds Chromium. One window holds the app's page,
// served from its own origin (app_scheme.h); the renderer attaches the
// compiled program to every frame (app_observer.h). Its resources are its
// own pak (nts_app.pak). DevTools listens only when --remote-debugging-port
// asks, as Chrome's does. No Chromium file is patched.
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/ref_counted_memory.h"
#include "base/path_service.h"
#include "base/run_loop.h"
#include "base/strings/string_number_conversions.h"
#include "content/public/app/content_main.h"
#include "content/public/app/content_main_delegate.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_main_parts.h"
#include "content/public/browser/content_browser_client.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_manager_delegate.h"
#include "content/public/browser/devtools_socket_factory.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/storage_partition.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/common/content_client.h"
#include "content/public/common/content_switches.h"
#include "content/public/renderer/content_renderer_client.h"
#include "net/base/ip_endpoint.h"
#include "net/base/net_errors.h"
#include "net/log/net_log_source.h"
#include "net/socket/tcp_server_socket.h"
#include "nts/app_observer.h"
#include "nts/app_scheme.h"
#include "ui/base/l10n/l10n_util.h"
#include "ui/base/resource/resource_bundle.h"
#include "ui/display/screen.h"
#include "ui/gfx/image/image.h"
#include "ui/linux/linux_ui.h"
#include "ui/linux/linux_ui_factory.h"
#include "ui/views/controls/webview/webview.h"
#include "ui/views/views_delegate.h"
#include "ui/views/widget/desktop_aura/desktop_native_widget_aura.h"
#include "ui/views/widget/desktop_aura/desktop_screen.h"
#include "ui/views/widget/native_widget_aura.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/wm/core/wm_state.h"
#include "url/gurl.h"

namespace nts_chromium {
namespace {

// -- every process ---------------------------------------------------------

// Resources from the shell's own pak, beside the executable.
class ShellContentClient final : public content::ContentClient {
 public:
  void AddAdditionalSchemes(Schemes* schemes) override {
    AddAppScheme(schemes);
  }
  std::u16string GetLocalizedString(int message_id) override {
    return l10n_util::GetStringUTF16(message_id);
  }
  std::string_view GetDataResource(
      int resource_id,
      ui::ResourceScaleFactor scale_factor) override {
    return ui::ResourceBundle::GetSharedInstance().GetRawDataResourceForScale(
        resource_id, scale_factor);
  }
  scoped_refptr<base::RefCountedMemory> GetDataResourceBytes(
      int resource_id) override {
    return ui::ResourceBundle::GetSharedInstance().LoadDataResourceBytes(
        resource_id);
  }
  std::string GetDataResourceString(int resource_id) override {
    return ui::ResourceBundle::GetSharedInstance().LoadDataResourceString(
        resource_id);
  }
  gfx::Image& GetNativeImageNamed(int resource_id) override {
    return ui::ResourceBundle::GetSharedInstance().GetNativeImageNamed(
        resource_id);
  }
};

// -- renderer --------------------------------------------------------------

class ShellRendererClient final : public content::ContentRendererClient {
 public:
  void RenderThreadStarted() override { RegisterAppSchemeInRenderer(); }
  void RenderFrameCreated(content::RenderFrame* frame) override {
    AttachApp(frame);
  }
};

// -- browser ---------------------------------------------------------------

// The profile: storage keyed by the app's origin lives under it. No
// downloads, notifications, push or permission prompts: a permission with no
// delegate is denied, which is a shell's default until an app declares one.
class ShellBrowserContext final : public content::BrowserContext {
 public:
  explicit ShellBrowserContext(base::FilePath path) : path_(std::move(path)) {}
  ~ShellBrowserContext() override {
    NotifyWillBeDestroyed();
    ShutdownStoragePartitions();
  }

  std::unique_ptr<content::ZoomLevelDelegate> CreateZoomLevelDelegate(
      const base::FilePath&) override {
    return nullptr;
  }
  base::FilePath GetPath() const override { return path_; }
  bool IsOffTheRecord() override { return false; }
  content::DownloadManagerDelegate* GetDownloadManagerDelegate() override {
    return nullptr;
  }
  content::BrowserPluginGuestManager* GetGuestManager() override {
    return nullptr;
  }
  storage::SpecialStoragePolicy* GetSpecialStoragePolicy() override {
    return nullptr;
  }
  content::PlatformNotificationService* GetPlatformNotificationService()
      override {
    return nullptr;
  }
  content::PushMessagingService* GetPushMessagingService() override {
    return nullptr;
  }
  content::StorageNotificationService* GetStorageNotificationService()
      override {
    return nullptr;
  }
  content::SSLHostStateDelegate* GetSSLHostStateDelegate() override {
    return nullptr;
  }
  content::PermissionControllerDelegate* GetPermissionControllerDelegate()
      override {
    return nullptr;
  }
  content::ReduceAcceptLanguageControllerDelegate*
  GetReduceAcceptLanguageControllerDelegate() override {
    return nullptr;
  }
  content::ClientHintsControllerDelegate* GetClientHintsControllerDelegate()
      override {
    return nullptr;
  }
  content::BackgroundFetchDelegate* GetBackgroundFetchDelegate() override {
    return nullptr;
  }
  content::BackgroundSyncController* GetBackgroundSyncController() override {
    return nullptr;
  }
  content::BrowsingDataRemoverDelegate* GetBrowsingDataRemoverDelegate()
      override {
    return nullptr;
  }

 private:
  const base::FilePath path_;
};

// The app's window: the page, titled by it, closed by it (window.close())
// or by the window manager. It owns its widget and the page; the widget,
// declared after the page, goes first, and with it the view showing the
// page.
class AppWindow final : public views::WidgetDelegate,
                        public content::WebContentsDelegate,
                        public content::WebContentsObserver {
 public:
  AppWindow(content::BrowserContext* context, base::OnceClosure closed)
      : web_contents_(content::WebContents::Create(
            content::WebContents::CreateParams(context))) {
    web_contents_->SetDelegate(this);
    Observe(web_contents_.get());
    SetHasWindowSizeControls(true);
    RegisterWindowClosingCallback(std::move(closed));
    auto view = std::make_unique<views::WebView>(context);
    view->SetWebContents(web_contents_.get());
    SetContentsView(std::move(view));
  }

  void Open(const GURL& url, const gfx::Size& size) {
    widget_ = std::make_unique<views::Widget>();
    views::Widget::InitParams params(
        views::Widget::InitParams::CLIENT_OWNS_WIDGET);
    params.bounds = gfx::Rect(size);
    params.delegate = this;
    params.wm_class_class = "nts-app";
    params.wm_class_name = params.wm_class_class;
    widget_->Init(std::move(params));
    web_contents_->GetController().LoadURLWithParams(
        content::NavigationController::LoadURLParams(url));
    widget_->Show();
    web_contents_->Focus();
  }

  // views::WidgetDelegate
  std::u16string GetWindowTitle() const override {
    return web_contents_->GetTitle();
  }

  // content::WebContentsDelegate
  void CloseContents(content::WebContents*) override {
    if (widget_)
      widget_->Close();
  }

  // content::WebContentsObserver
  void TitleWasSet(content::NavigationEntry*) override {
    if (widget_)
      widget_->UpdateWindowTitle();
  }

 private:
  std::unique_ptr<content::WebContents> web_contents_;
  std::unique_ptr<views::Widget> widget_;
};

// Top-level widgets on the desktop, as a desktop Chrome window is one.
class ShellViewsDelegate final : public views::ViewsDelegate {
 public:
  void OnBeforeWidgetInit(views::Widget::InitParams* params,
                          views::internal::NativeWidgetDelegate* delegate)
      override {
    if (params->native_widget)
      return;
    if (params->parent &&
        params->type != views::Widget::InitParams::TYPE_MENU &&
        params->type != views::Widget::InitParams::TYPE_TOOLTIP) {
      params->native_widget = new views::NativeWidgetAura(delegate);
    } else {
      params->native_widget = new views::DesktopNativeWidgetAura(delegate);
    }
  }
};

// DevTools over TCP on the port --remote-debugging-port names (0: any).
class DevToolsSocketFactory final : public content::DevToolsSocketFactory {
 public:
  explicit DevToolsSocketFactory(uint16_t port) : port_(port) {}

 private:
  std::unique_ptr<net::ServerSocket> CreateForHttpServer() override {
    auto socket =
        std::make_unique<net::TCPServerSocket>(nullptr, net::NetLogSource());
    if (socket->ListenWithAddressAndPort("127.0.0.1", port_, /*backlog=*/10) !=
        net::OK) {
      return nullptr;
    }
    return socket;
  }
  std::unique_ptr<net::ServerSocket> CreateForTethering(std::string*) override {
    return nullptr;
  }

  const uint16_t port_;
};

// The profile's directory: --user-data-dir (Chrome's spelling), or one per
// app under the user's configuration directory.
constexpr char kUserDataDirSwitch[] = "user-data-dir";
base::FilePath ProfileDirectory() {
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  if (command_line.HasSwitch(kUserDataDirSwitch))
    return command_line.GetSwitchValuePath(kUserDataDirSwitch);
  base::FilePath home;
  CHECK(base::PathService::Get(base::DIR_HOME, &home));
  const base::FilePath app = AppDirectory();
  return home.Append(".config").Append("nts-app").Append(
      app.empty() ? base::FilePath("default") : app.BaseName());
}

class ShellBrowserMainParts final : public content::BrowserMainParts {
 public:
  void ToolkitInitialized() override {
    ui::LinuxUi::SetInstance(ui::GetDefaultLinuxUi());
  }

  int PreMainMessageLoopRun() override {
    wm_state_ = std::make_unique<wm::WMState>();
    if (!display::Screen::HasScreen())
      screen_ = views::CreateDesktopScreen();
    views_delegate_ = std::make_unique<ShellViewsDelegate>();
    context_ = std::make_unique<ShellBrowserContext>(ProfileDirectory());

    const base::CommandLine& command_line =
        *base::CommandLine::ForCurrentProcess();
    if (command_line.HasSwitch(switches::kRemoteDebuggingPort)) {
      unsigned port = 0;
      base::StringToUint(
          command_line.GetSwitchValueASCII(switches::kRemoteDebuggingPort),
          &port);
      content::DevToolsAgentHost::StartRemoteDebuggingServer(
          std::make_unique<DevToolsSocketFactory>(static_cast<uint16_t>(port)),
          context_->GetPath(), base::FilePath());
    }

    // The page the command line names, or the app's own.
    const base::CommandLine::StringVector& args = command_line.GetArgs();
    const GURL url(args.empty() ? std::string(kAppScheme) + "://" + kAppHost +
                                      "/index.html"
                                : args.front());
    window_ = std::make_unique<AppWindow>(
        context_.get(), base::BindOnce(&ShellBrowserMainParts::Closed,
                                       base::Unretained(this)));
    window_->Open(url, gfx::Size(1024, 768));
    return 0;
  }

  void WillRunMainMessageLoop(
      std::unique_ptr<base::RunLoop>& run_loop) override {
    quit_ = run_loop->QuitClosure();
  }

  content::BrowserContext* context() const { return context_.get(); }

  void PostMainMessageLoopRun() override {
    content::DevToolsAgentHost::StopRemoteDebuggingServer();
    window_.reset();
    context_.reset();
    views_delegate_.reset();
    screen_.reset();
    wm_state_.reset();
    ui::LinuxUi::SetInstance(nullptr);
  }

 private:
  // The window is closing; it is destroyed once the loop has quit.
  void Closed() {
    if (quit_)
      std::move(quit_).Run();
  }

  std::unique_ptr<wm::WMState> wm_state_;
  std::unique_ptr<display::Screen> screen_;
  std::unique_ptr<views::ViewsDelegate> views_delegate_;
  std::unique_ptr<ShellBrowserContext> context_;
  std::unique_ptr<AppWindow> window_;
  base::OnceClosure quit_;
};

// DevTools' view of the shell: the one profile, for its targets.
class ShellDevToolsDelegate final : public content::DevToolsManagerDelegate {
 public:
  explicit ShellDevToolsDelegate(content::BrowserContext* context)
      : context_(context) {}
  content::BrowserContext* GetDefaultBrowserContext() override {
    return context_;
  }

 private:
  raw_ptr<content::BrowserContext> context_;
};

class ShellBrowserClient final : public content::ContentBrowserClient {
 public:
  explicit ShellBrowserClient(base::FilePath root) : root_(std::move(root)) {}

  std::unique_ptr<content::BrowserMainParts> CreateBrowserMainParts(
      bool) override {
    // Here rather than at construction: the policy reads features, which
    // exist from browser main on.
    RegisterAppSchemeInBrowser();
    auto parts = std::make_unique<ShellBrowserMainParts>();
    main_parts_ = parts.get();
    return parts;
  }

  std::unique_ptr<content::DevToolsManagerDelegate>
  CreateDevToolsManagerDelegate() override {
    return std::make_unique<ShellDevToolsDelegate>(main_parts_->context());
  }

  bool IsHandledURL(const GURL& url) override {
    return url.SchemeIs(kAppScheme);
  }

  mojo::PendingRemote<network::mojom::URLLoaderFactory>
  CreateNonNetworkNavigationURLLoaderFactory(
      const std::string& scheme,
      content::FrameTreeNodeId) override {
    if (scheme == kAppScheme && !root_.empty())
      return CreateAppURLLoaderFactory(root_);
    return {};
  }

  void RegisterNonNetworkSubresourceURLLoaderFactories(
      int,
      int,
      const std::optional<url::Origin>&,
      NonNetworkURLLoaderFactoryMap* factories) override {
    if (!root_.empty())
      factories->emplace(kAppScheme, CreateAppURLLoaderFactory(root_));
  }

 private:
  // Empty without --nts-app-dir: the scheme is registered but serves nothing.
  const base::FilePath root_;
  raw_ptr<ShellBrowserMainParts> main_parts_ = nullptr;
};

// -- startup ---------------------------------------------------------------

class ShellMainDelegate final : public content::ContentMainDelegate {
 public:
  void PreSandboxStartup() override {
    base::FilePath pak;
    CHECK(base::PathService::Get(base::DIR_ASSETS, &pak));
    ui::ResourceBundle::InitSharedInstanceWithPakPath(
        pak.Append(FILE_PATH_LITERAL("nts_app.pak")));
  }
  content::ContentClient* CreateContentClient() override {
    content_client_ = std::make_unique<ShellContentClient>();
    return content_client_.get();
  }
  content::ContentBrowserClient* CreateContentBrowserClient() override {
    browser_client_ = std::make_unique<ShellBrowserClient>(AppDirectory());
    return browser_client_.get();
  }
  content::ContentRendererClient* CreateContentRendererClient() override {
    renderer_client_ = std::make_unique<ShellRendererClient>();
    return renderer_client_.get();
  }

 private:
  std::unique_ptr<ShellContentClient> content_client_;
  std::unique_ptr<ShellBrowserClient> browser_client_;
  std::unique_ptr<ShellRendererClient> renderer_client_;
};

}  // namespace
}  // namespace nts_chromium

int main(int argc, const char** argv) {
  nts_chromium::ShellMainDelegate delegate;
  content::ContentMainParams params(&delegate);
  params.argc = argc;
  params.argv = argv;
  return content::ContentMain(std::move(params));
}
