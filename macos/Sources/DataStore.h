#import <WebKit/WebKit.h>

// root(이미 있고 쓰기 가능한 디렉터리) 아래에 모든 웹사이트 데이터를 두는 영구 저장소를 만든다.
// WebKit SPI가 없거나 검증에 실패하면 nil을 돌려준다. 기본 저장소(~/Library/WebKit)는 건드리지 않으며 메인 스레드에서만 호출한다.
FOUNDATION_EXTERN WKWebsiteDataStore * _Nullable RPTMakeDataStore(NSURL * _Nonnull root);
