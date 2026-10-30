// Supplemental audit: identical semantic banks in an optimized C++17 host.
// No Python dispatch in query timing. This was added after the primary test.
#include <algorithm>
#include <cstdint>
#include <iostream>
#include <numeric>
#include <random>
#include <string>
#include <time.h>
#include <unordered_map>
#include <vector>
#include <cmath>
using namespace std;
using Bits = vector<uint64_t>;
uint64_t now_ns() { timespec t; clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &t); return t.tv_sec * 1000000000ull + t.tv_nsec; }
string decode(const string& hex) {
  string s; for (size_t i=0;i<hex.size();i+=2) s += char(stoul(hex.substr(i,2), nullptr,16)); return s;
}
struct Bank {
  int n, b, w; vector<string> tables; unordered_map<string,int> exact;
  vector<vector<vector<int>>> fibers; vector<string> inverses;
  vector<Bits> bits; vector<int> order;
  uint64_t preparation_ns;
  Bank(vector<string> input): n(input[0].size()), b(input.size()), w((b+63)/64), tables(move(input)) {
    uint64_t start=now_ns(); bits.assign(n*n, Bits(w));
    vector<vector<int>> counts(n,vector<int>(n));
    for(int i=0;i<b;i++) {
      exact[tables[i]]=i;
      vector<vector<int>> fiber(n);
      for(int x=0;x<n;x++) {
        int v=(unsigned char)tables[i][x];
        bits[x*n+v][i/64] |= 1ull<<(i%64); counts[x][v]++; fiber[v].push_back(x);
      }
      string inverse;
      for(int y=0;y<n;y++) { if(fiber[y].size()!=1) {inverse.clear();break;} inverse += char(fiber[y][0]); }
      inverses.push_back(inverse); fibers.push_back(move(fiber));
    }
    vector<double> entropy(n);
    for(int x=0;x<n;x++) for(int count: counts[x]) if(count) {double p=double(count)/b;entropy[x]-=p*log2(p);}
    order.resize(n);iota(order.begin(),order.end(),0);
    stable_sort(order.begin(),order.end(),[&](int x,int y){return entropy[x]>entropy[y];});
    preparation_ns=now_ns()-start;
  }
  bool match(int i,int j,const string& target) const {
    const auto& p=tables[i];const auto& s=tables[j];
    for(int x=0;x<n;x++) if(s[(unsigned char)p[x]]!=target[x]) return false;
    return true;
  }
  pair<int,int> solve(const string& target,int method) const {
    for(int j=0;j<b;j++) {
      if(method && !inverses[j].empty()) {
        string required(n,'\0');
        for(int x=0;x<n;x++) required[x]=inverses[j][(unsigned char)target[x]];
        auto it=exact.find(required);if(it!=exact.end()) return {it->second,j};continue;
      }
      if(method!=2) { for(int i=0;i<b;i++) if(match(i,j,target)) return {i,j}; continue; }
      Bits remaining(w,~0ull);if(b%64) remaining.back()=(1ull<<(b%64))-1;
      for(int x:order) {
        int count=0;for(auto block:remaining) {count+=__builtin_popcountll(block);if(count>4)break;}
        if(count<=4) break;
        Bits mask(w);
        for(int v:fibers[j][(unsigned char)target[x]]) for(int k=0;k<w;k++) mask[k]|=bits[x*n+v][k];
        bool any=false;for(int k=0;k<w;k++) {remaining[k]&=mask[k];any|=bool(remaining[k]);}
        if(!any)break;
      }
      for(int k=0;k<w;k++) {auto block=remaining[k];while(block) {
        int i=64*k+__builtin_ctzll(block);if(match(i,j,target))return {i,j};block&=block-1;
      }}
    }
    return {-1,-1};
  }
};
int main() {
  int total;cin>>total;mt19937 rng(92003);cout<<"[";
  for(int c=0;c<total;c++) {
    string id,hex;int b,q;cin>>id>>b>>q;vector<string> tables,targets;
    for(int i=0;i<b;i++){cin>>hex;tables.push_back(decode(hex));}
    for(int i=0;i<q;i++){cin>>hex;targets.push_back(decode(hex));}
    Bank bank(move(tables));vector<vector<uint64_t>> timings(3);
    for(int repeat=0;repeat<7;repeat++) {
      vector<int> methods={0,1,2};shuffle(methods.begin(),methods.end(),rng);
      for(int method:methods) {
        vector<pair<int,int>> answers;uint64_t start=now_ns();
        for(const auto& target:targets)answers.push_back(bank.solve(target,method));
        timings[method].push_back(now_ns()-start);
        for(int i=0;i<q;i++) if(answers[i].first<0 || !bank.match(answers[i].first,answers[i].second,targets[i])) {
          cerr<<"Incorrect native solver: "<<id<<endl;return 2;
        }
      }
    }
    if(c)cout<<",";
    cout<<"{\"id\":\""<<id<<"\",\"preparation_ns\":"<<bank.preparation_ns<<",\"query_batch_cpu_ns\":{";
    vector<string> names={"cpp_pairwise","cpp_inverse_hash","cpp_hybrid"};
    for(int m=0;m<3;m++) {if(m)cout<<",";cout<<"\""<<names[m]<<"\":[";
      for(int r=0;r<7;r++){if(r)cout<<",";cout<<timings[m][r];}cout<<"]";}
    cout<<"}}";
  }
  cout<<"]\n";
}
