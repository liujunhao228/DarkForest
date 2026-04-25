'use client';

// ============================
// 回放页面
// ============================

import React, { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ReplayList } from '@/components/online/ReplayList';
import { ReplayPlayer } from '@/components/online/ReplayPlayer';
import type { ReplayItem } from '@/components/online/ReplayList';

export default function ReplayPage() {
  const [selectedReplay, setSelectedReplay] = useState<ReplayItem | null>(null);

  const handleSelectReplay = (replay: ReplayItem) => {
    setSelectedReplay(replay);
  };

  const handleCloseReplay = () => {
    setSelectedReplay(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <PageHeader title="战局回放" />
      
      <div className="container mx-auto px-4 py-8">
        {selectedReplay ? (
          <div className="space-y-6">
            <ReplayPlayer 
              replayId={selectedReplay.id} 
              onClose={handleCloseReplay} 
            />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold mb-2">选择要观看的回放</h2>
              <p className="text-muted-foreground">
                在这里你可以查看之前游戏的完整回放，分析战术和决策
              </p>
            </div>
            <ReplayList onSelectReplay={handleSelectReplay} />
          </div>
        )}
      </div>
    </div>
  );
}
