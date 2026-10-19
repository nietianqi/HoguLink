'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="wrap page-section">
      <div className="empty-state">
        <h1>接続できません / Unable to connect / 暂时无法连接</h1>
        <p>
          サービスを起動して再試行してください。Please check that the local API is running.
          请确认本地服务已启动。
        </p>
        <button className="button" onClick={reset}>
          再試行 / Try again / 重试
        </button>
      </div>
    </main>
  );
}
